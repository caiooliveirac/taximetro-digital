import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { users, userRoles, faculties, assignments } from "@/db/schema";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";

function weekBounds(offset: number) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
  };
}

/** Number of ISO weeks between two Monday-based week starts */
function weeksBetween(dateA: string, dateB: string) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.floor((b.getTime() - a.getTime()) / (7 * 86_400_000));
}

const COMPLETED = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] as const;
const today = () => new Date().toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token) {
    return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  let facultyId = searchParams.get("facultyId");
  const internId = searchParams.get("internId");

  // Leaders auto-filter by their faculty
  if (token.role === "LEADER" && token.facultyId) {
    facultyId = token.facultyId as string;
  }

  // Interns see only themselves; Coordinator can view a specific intern
  let internOnly: string | null = null;
  if (token.role === "INTERN") {
    internOnly = token.id as string;
  } else if (token.role === "COORDINATOR" && internId) {
    internOnly = internId;
  }

  // 1. Fetch active interns (optionally filtered by faculty or specific intern)
  const internConditions = [
    eq(userRoles.role, "INTERN"),
    eq(userRoles.isActive, true),
  ];
  if (facultyId) internConditions.push(eq(userRoles.facultyId, facultyId));

  const internRows = await db
    .select({
      userId: users.id,
      name: users.name,
      facultyId: userRoles.facultyId,
      facultyAbbr: faculties.abbreviation,
      targetShifts: faculties.targetShifts,
      targetHours: faculties.targetHours,
      targetShiftsPerWeek: faculties.targetShiftsPerWeek,
    })
    .from(userRoles)
    .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.isActive, true)))
    .innerJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .where(and(...internConditions));

  let interns = internOnly
    ? internRows.filter((r) => r.userId === internOnly)
    : internRows;

  if (interns.length === 0) {
    return NextResponse.json({ success: true, data: [], summary: { totalInterns: 0, belowWeeklyTarget: 0, belowTotalTarget: 0, compensating: 0, weekRange: { thisWeek: weekBounds(0), lastWeek: weekBounds(-1) } } });
  }

  const internIds = interns.map((i) => i.userId);

  // 2. Fetch all non-cancelled assignments for these interns
  const allAssignments = await db
    .select({
      internId: assignments.internId,
      date: assignments.date,
      status: assignments.status,
    })
    .from(assignments)
    .where(and(
      inArray(assignments.internId, internIds),
      sql`${assignments.status} != 'CANCELLED'`,
    ));

  // 3. Compute week bounds
  const thisWeek = weekBounds(0);
  const lastWeek = weekBounds(-1);
  const todayStr = today();

  // 4. Build per-intern compliance
  const assignmentsByIntern = new Map<string, typeof allAssignments>();
  for (const a of allAssignments) {
    const list = assignmentsByIntern.get(a.internId) ?? [];
    list.push(a);
    assignmentsByIntern.set(a.internId, list);
  }

  const data = interns.map((intern) => {
    const rows = assignmentsByIntern.get(intern.userId) ?? [];

    // Past & present (date <= today)
    const pastRows = rows.filter((r) => r.date <= todayStr);
    const totalCompleted = pastRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number])).length;
    const totalAbsent = pastRows.filter((r) => r.status === "ABSENT").length;

    // Future scheduled (date > today, status SCHEDULED or CONFIRMED)
    const futureRows = rows.filter((r) => r.date > todayStr);
    const futureScheduled = futureRows.length;

    const totalScheduled = rows.length;

    // This week
    const thisWeekRows = rows.filter((r) => r.date >= thisWeek.from && r.date <= thisWeek.to);
    const thisWeekCompleted = thisWeekRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number])).length;
    const thisWeekAbsent = thisWeekRows.filter((r) => r.status === "ABSENT").length;
    const thisWeekScheduled = thisWeekRows.length;

    // Last week
    const lastWeekRows = rows.filter((r) => r.date >= lastWeek.from && r.date <= lastWeek.to);
    const lastWeekCompleted = lastWeekRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number])).length;

    // Expected shifts up to now: use earliest assignment as start reference
    const weeklyTarget = intern.targetShiftsPerWeek ?? 0;
    let expectedToNow = 0;
    if (weeklyTarget > 0 && rows.length > 0) {
      const earliest = rows.reduce((min, r) => r.date < min ? r.date : min, rows[0].date);
      // Get Monday of earliest week
      const earlyDate = new Date(earliest);
      const earlyDay = earlyDate.getDay();
      const earlyMon = new Date(earlyDate);
      earlyMon.setDate(earlyDate.getDate() - (earlyDay === 0 ? 6 : earlyDay - 1));
      const earlyMonStr = earlyMon.toISOString().slice(0, 10);

      // Weeks elapsed (including current week)
      const weeksElapsed = weeksBetween(earlyMonStr, thisWeek.from) + 1;
      expectedToNow = weeksElapsed * weeklyTarget;
    }

    // Deficit logic: does the intern have enough completed + future to cover expected?
    const rawDeficit = Math.max(0, expectedToNow - totalCompleted);
    const netDeficit = Math.max(0, rawDeficit - futureScheduled);
    const compensating = rawDeficit > 0 && futureScheduled > 0 && netDeficit === 0;
    const partiallyCompensating = rawDeficit > 0 && futureScheduled > 0 && netDeficit > 0;

    // Total target deficit
    const totalDeficit = Math.max(0, (intern.targetShifts ?? 0) - totalCompleted);

    // Weekly: was last week below target?
    const weeklyDeficit = Math.max(0, weeklyTarget - lastWeekCompleted);
    const belowWeeklyTarget = weeklyTarget > 0 && lastWeekCompleted < weeklyTarget;

    const totalPct = (intern.targetShifts ?? 0) > 0
      ? Math.min(100, Math.round((totalCompleted / intern.targetShifts!) * 100))
      : null;

    // Compliance status:
    // "ok" = on track, "compensating" = behind but future shifts cover it,
    // "partial" = behind, future shifts help but not enough, "deficit" = behind with no future coverage
    let status: "ok" | "compensating" | "partial" | "deficit" = "ok";
    if (rawDeficit > 0) {
      if (netDeficit === 0) status = "compensating";
      else if (futureScheduled > 0) status = "partial";
      else status = "deficit";
    }

    return {
      userId: intern.userId,
      name: intern.name,
      facultyId: intern.facultyId,
      facultyAbbr: intern.facultyAbbr,
      // Targets
      targetShifts: intern.targetShifts ?? 0,
      targetHours: intern.targetHours ?? 0,
      targetShiftsPerWeek: intern.targetShiftsPerWeek ?? 0,
      // Totals
      totalScheduled,
      totalCompleted,
      totalAbsent,
      totalHours: totalCompleted * 12,
      totalDeficit,
      totalPct,
      // Expected vs actual
      expectedToNow,
      rawDeficit,
      futureScheduled,
      netDeficit,
      compensating,
      status,
      // This week
      thisWeekScheduled,
      thisWeekCompleted,
      thisWeekAbsent,
      // Last week
      lastWeekCompleted,
      weeklyDeficit,
      belowWeeklyTarget,
    };
  });

  // Sort by name
  data.sort((a, b) => a.name.localeCompare(b.name));

  // Summary
  const belowWeeklyCount = data.filter((d) => d.belowWeeklyTarget).length;
  const belowTotalCount = data.filter((d) => d.totalDeficit > 0).length;
  const compensatingCount = data.filter((d) => d.status === "compensating").length;

  return NextResponse.json({
    success: true,
    data,
    summary: {
      totalInterns: data.length,
      belowWeeklyTarget: belowWeeklyCount,
      belowTotalTarget: belowTotalCount,
      compensating: compensatingCount,
      weekRange: { thisWeek, lastWeek },
    },
  });
}
