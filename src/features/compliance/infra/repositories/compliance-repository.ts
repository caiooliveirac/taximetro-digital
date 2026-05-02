import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { assignments, bases, cohorts, faculties, userRoles, users } from "@/shared/db/schema";

export async function listActiveComplianceSubjects(params: {
  roleFilter: Array<"INTERN" | "LEADER">;
  facultyId?: string;
  personOnly?: string;
}) {
  const conditions = [
    inArray(userRoles.role, params.roleFilter),
    eq(userRoles.isActive, true),
    eq(userRoles.isArchived, false),
  ];

  if (params.facultyId) {
    conditions.push(eq(userRoles.facultyId, params.facultyId));
  }

  if (params.personOnly) {
    conditions.push(eq(userRoles.userId, params.personOnly));
  }

  const roleRank = sql<number>`CASE ${userRoles.role} WHEN 'INTERN' THEN 0 WHEN 'LEADER' THEN 1 ELSE 2 END`;

  return db
    .select({
      userId: users.id,
      name: users.name,
      role: userRoles.role,
      facultyId: userRoles.facultyId,
      facultyAbbr: faculties.abbreviation,
      // Cohort.startDate é a verdade per-intern; faculties.rotationStartDate
      // é um ponteiro global que pode defasar do cohort atual e provoca
      // filtro errado em relevantRows (plantões reais ficam fora).
      rotationStartDate: sql<string>`COALESCE(${cohorts.startDate}, ${faculties.rotationStartDate})`,
      rotationEndDate: cohorts.endDate,
      targetShifts: faculties.targetShifts,
      targetHours: faculties.targetHours,
      targetShiftsPerWeek: faculties.targetShiftsPerWeek,
      targetUSAsPerWeek: faculties.targetUSAsPerWeek,
      targetUSAsTotal: faculties.targetUSAsTotal,
      targetCRUsPerWeek: faculties.targetCRUsPerWeek,
      targetCRUsTotal: faculties.targetCRUsTotal,
      targetCRLsPerWeek: faculties.targetCRLsPerWeek,
    })
    .from(userRoles)
    .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.isActive, true)))
    .innerJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .leftJoin(cohorts, eq(cohorts.id, userRoles.cohortId))
    .where(and(...conditions))
    .orderBy(roleRank, users.name);
}

export async function listNonCancelledAssignmentsForInterns(internIds: string[]) {
  return db
    .select({
      internId: assignments.internId,
      date: assignments.date,
      status: assignments.status,
      shift: assignments.shift,
      baseType: bases.type,
    })
    .from(assignments)
    .innerJoin(bases, eq(assignments.baseId, bases.id))
    .where(and(
      inArray(assignments.internId, internIds),
      sql`${assignments.status} != 'CANCELLED'`,
      eq(assignments.isExtraShift, false),
    ));
}
