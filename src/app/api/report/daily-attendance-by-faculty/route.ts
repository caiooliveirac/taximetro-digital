import { db } from "@/shared/db/client";
import { assignments, bases, checkins, faculties, users, userRoles } from "@/shared/db/schema";
import { and, eq, gte, lte, isNotNull, ne } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

type InternRow = {
  internId: string;
  internName: string;
  facultyAbbr: string;
  facultyId: string;
  isArchived: boolean;
};

type AssignmentRow = {
  assignmentId: string;
  internId: string;
  date: string;
  period: string;
  baseCode: string;
  baseName: string;
  baseType: string | null;
  status: string;
  shift: string | null;
  checkinAt: string | null;
  checkoutAt: string | null;
  absenceJustification: string | null;
  absenceJustificationActor: string | null;
};

export type DailyAttendanceByFaculty = {
  facultyId: string;
  facultyAbbr: string;
  generatedAt: string;
  interns: Array<{
    internId: string;
    internName: string;
    isArchived: boolean;
    assignments: Array<{
      assignmentId: string;
      date: string;
      period: string;
      baseCode: string;
      baseName: string;
      baseType: string | null;
      status: string;
      shift: string | null;
      checkinAt: string | null;
      checkoutAt: string | null;
      isJustified: boolean;
      absenceJustification: string | null;
    }>;
    stats: {
      totalUSAs: number;
      totalCheckedIn: number;
      totalCheckedOut: number;
      totalAbsent: number;
      totalAbsentJustified: number;
      totalAbsentNotJustified: number;
      totalScheduled: number;
    };
  }>;
};

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const dateStr = params.get("date") ?? new Date().toISOString().split("T")[0];
  
  // Get start and end of given date for querying last 30 days up to date
  const endDate = dateStr;
  const startDate = new Date(dateStr);
  startDate.setDate(startDate.getDate() - 30);
  const startDateStr = startDate.toISOString().split("T")[0];

  // Get all active interns with their faculties, grouped by faculty
  const allInterns = await db
    .select({
      internId: users.id,
      internName: users.name,
      facultyId: faculties.id,
      facultyAbbr: faculties.abbreviation,
      isArchived: userRoles.isArchived,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .where(
      and(
        eq(userRoles.role, "INTERN"),
        eq(userRoles.isArchived, false),
        eq(userRoles.isActive, true),
        eq(users.isActive, true)
      )
    )
    .orderBy(users.name);

  // Get all assignments for the date range (30 days)
  const allAssignments = await db
    .select({
      assignmentId: assignments.id,
      internId: assignments.internId,
      date: assignments.date,
      period: assignments.period,
      baseCode: bases.code,
      baseName: bases.name,
      baseType: bases.type,
      status: assignments.status,
      shift: assignments.shift,
      checkinAt: checkins.checkinAt,
      checkoutAt: checkins.checkoutAt,
      absenceJustification: assignments.absenceJustification,
      absenceJustificationActor: assignments.absenceJustificationActor,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
    .leftJoin(checkins, eq(checkins.assignmentId, assignments.id))
    .where(
      and(
        gte(assignments.date, startDateStr),
        lte(assignments.date, endDate),
        ne(assignments.status, "CANCELLED")
      )
    )
    .orderBy(assignments.date, assignments.period);

  // Group by faculty
  const internsByFaculty = new Map<string, typeof allInterns>();
  const assignmentsByIntern = new Map<string, typeof allAssignments>();

  for (const intern of allInterns) {
    const facultyKey = intern.facultyAbbr ?? "SEM_FACULDADE";
    if (!internsByFaculty.has(facultyKey)) {
      internsByFaculty.set(facultyKey, []);
    }
    internsByFaculty.get(facultyKey)!.push(intern);
  }

  for (const assignment of allAssignments) {
    if (!assignmentsByIntern.has(assignment.internId)) {
      assignmentsByIntern.set(assignment.internId, []);
    }
    assignmentsByIntern.get(assignment.internId)!.push(assignment);
  }

  // Build response
  const result: DailyAttendanceByFaculty[] = [];

  for (const [facultyAbbr, interns] of internsByFaculty.entries()) {
    // Remove duplicates by internId (same intern can be in multiple faculties in edge cases)
    const uniqueInterns = Array.from(new Map(interns.map(i => [i.internId, i])).values());

    const internDetails = uniqueInterns.map((intern) => {
      const assignments = assignmentsByIntern.get(intern.internId) ?? [];

      const stats = {
        totalUSAs: assignments.filter(a => a.baseType === "USA").length,
        totalCheckedIn: assignments.filter(a => a.status === "CHECKED_IN").length,
        totalCheckedOut: assignments.filter(a => a.status === "CHECKED_OUT").length,
        totalAbsent: assignments.filter(a => a.status === "ABSENT").length,
        totalAbsentJustified: assignments.filter(
          a => a.status === "ABSENT" && a.absenceJustification !== null
        ).length,
        totalAbsentNotJustified: assignments.filter(
          a => a.status === "ABSENT" && a.absenceJustification === null
        ).length,
        totalScheduled: assignments.filter(
          a => a.status === "SCHEDULED" || a.status === "CONFIRMED"
        ).length,
      };

      return {
        internId: intern.internId,
        internName: intern.internName,
        isArchived: intern.isArchived,
        assignments: assignments.map(a => ({
          assignmentId: a.assignmentId,
          date: a.date,
          period: a.period,
          baseCode: a.baseCode,
          baseName: a.baseName,
          baseType: a.baseType,
          status: a.status,
          shift: a.shift,
          checkinAt: a.checkinAt?.toISOString() ?? null,
          checkoutAt: a.checkoutAt?.toISOString() ?? null,
          isJustified: a.absenceJustification !== null,
          absenceJustification: a.absenceJustification,
        })),
        stats,
      };
    });

    // Sort by faculty abbreviation
    const facultyId = uniqueInterns[0]?.facultyId ?? "";
    result.push({
      facultyId,
      facultyAbbr,
      generatedAt: new Date().toISOString(),
      interns: internDetails.sort((a, b) => a.internName.localeCompare(b.internName)),
    });
  }

  // Sort faculties alphabetically
  result.sort((a, b) => a.facultyAbbr.localeCompare(b.facultyAbbr));

  return NextResponse.json({ success: true, data: result });
}
