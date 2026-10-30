import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { assignments, bases, cohorts, faculties, facultyTargetShifts, userRoles, users } from "@/shared/db/schema";

export async function listActiveComplianceSubjects(params: {
  roleFilter: Array<"INTERN" | "LEADER">;
  facultyId?: string;
  cohortId?: string;
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

  if (params.cohortId) {
    conditions.push(eq(userRoles.cohortId, params.cohortId));
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
      // Metas diretas da faculdade. O total é a soma das três — não existe
      // meta de plantões avulsa nem meta semanal.
      targetHours: faculties.targetHours,
      targetUSAsTotal: faculties.targetUSAsTotal,
      targetCRUsTotal: faculties.targetCRUsTotal,
      targetCRLsTotal: faculties.targetCRLsTotal,
      targetShifts: facultyTargetShifts,
    })
    .from(userRoles)
    .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.isActive, true)))
    .innerJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .leftJoin(cohorts, eq(cohorts.id, userRoles.cohortId))
    .where(and(...conditions))
    .orderBy(roleRank, users.name);
}

export async function listNonCancelledAssignmentsForInterns(internIds: string[]) {
  // Plantão perdido por compromisso da turma e abonado (commitment_releases)
  // conta na meta como abonado. Só aqui, na conta da meta: o plantão segue
  // cancelado e a vaga continua livre para quem pegou.
  const abonado = sql`exists (select 1 from commitment_releases cr where cr.assignment_id = ${assignments.id} and cr.resolution = 'ABONADO')`;
  return db
    .select({
      id: assignments.id,
      internId: assignments.internId,
      date: assignments.date,
      period: assignments.period,
      status: sql<typeof assignments.$inferSelect.status>`case when ${assignments.status} = 'CANCELLED' then 'EXCUSED' else ${assignments.status} end`,
      shift: assignments.shift,
      baseType: bases.type,
    })
    .from(assignments)
    .innerJoin(bases, eq(assignments.baseId, bases.id))
    .where(and(
      inArray(assignments.internId, internIds),
      sql`(${assignments.status} != 'CANCELLED' or ${abonado})`,
      eq(assignments.isExtraShift, false),
    ));
}
