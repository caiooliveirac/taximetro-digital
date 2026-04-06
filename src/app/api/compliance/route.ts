import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, userRoles, faculties, assignments } from "@/db/schema";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";
import { getEffectiveUser } from "@/lib/impersonate";
import { addDaysToDateStr, operationalDateStr, startOfWeekDateStr, weeksBetweenDateStr } from "@/lib/utils";

function weekBounds(offset: number) {
  const operationalToday = operationalDateStr();
  const monday = addDaysToDateStr(startOfWeekDateStr(operationalToday), offset * 7);
  return {
    from: monday,
    to: addDaysToDateStr(monday, 6),
  };
}

const COMPLETED = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] as const;

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const selfOnly = searchParams.get("selfOnly") === "true";
  let facultyId = searchParams.get("facultyId");
  const internId = searchParams.get("internId");

  // Leaders auto-filter by their faculty
  if (user.role === "LEADER" && user.facultyId && !selfOnly) {
    facultyId = user.facultyId;
  }

  // Self-service leader pages should see the leader's own compliance using whichever
  // active role row exists first: INTERN if present, otherwise LEADER.
  let personOnly: string | null = null;
  let roleFilter: Array<"INTERN" | "LEADER"> = ["INTERN"];
  if (selfOnly && (user.role === "INTERN" || user.role === "LEADER")) {
    personOnly = user.id;
    roleFilter = user.role === "LEADER" ? ["INTERN", "LEADER"] : ["INTERN"];
  } else if (user.role === "INTERN") {
    personOnly = user.id;
  } else if (user.role === "COORDINATOR" && internId) {
    personOnly = internId;
  }

  // 1. Fetch active interns (optionally filtered by faculty or specific intern)
  const internConditions = [
    inArray(userRoles.role, roleFilter),
    eq(userRoles.isActive, true),
    eq(userRoles.isArchived, false),
  ];
  if (facultyId) internConditions.push(eq(userRoles.facultyId, facultyId));
  if (personOnly) internConditions.push(eq(userRoles.userId, personOnly));

  const roleRank = sql<number>`CASE ${userRoles.role} WHEN 'INTERN' THEN 0 WHEN 'LEADER' THEN 1 ELSE 2 END`;

  const rawInternRows = await db
    .select({
      userId: users.id,
      name: users.name,
      role: userRoles.role,
      facultyId: userRoles.facultyId,
      facultyAbbr: faculties.abbreviation,
      targetShifts: faculties.targetShifts,
      targetHours: faculties.targetHours,
      targetShiftsPerWeek: faculties.targetShiftsPerWeek,
    })
    .from(userRoles)
    .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.isActive, true)))
    .innerJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .where(and(...internConditions))
    .orderBy(roleRank, users.name);

  const internMap = new Map<string, Omit<(typeof rawInternRows)[number], "role">>();
  for (const row of rawInternRows) {
    if (!internMap.has(row.userId)) {
      const { role: _role, ...intern } = row;
      internMap.set(row.userId, intern);
    }
  }

  const interns = [...internMap.values()];

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
  const todayStr = operationalDateStr();

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
      const earlyMonStr = startOfWeekDateStr(earliest);

      // Weeks elapsed (including current week)
      const weeksElapsed = weeksBetweenDateStr(earlyMonStr, thisWeek.from) + 1;
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
