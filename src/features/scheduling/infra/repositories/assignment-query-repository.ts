import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { assignments, bases, checkins, faculties, userRoles, users } from "@/shared/db/schema";

export async function listAssignmentsWithRelations(params: {
  dateFrom?: string;
  dateTo?: string;
  facultyId?: string;
  baseId?: string;
  period?: "DAY" | "NIGHT";
  internId?: string;
  selfOnlyUserId?: string;
}) {
  let query = db
    .select({
      id: assignments.id,
      internId: assignments.internId,
      internName: users.name,
      facultyId: assignments.facultyId,
      facultyAbbr: faculties.abbreviation,
      baseId: assignments.baseId,
      baseCode: bases.code,
      baseName: bases.name,
      baseType: bases.type,
      baseLatitude: bases.latitude,
      baseLongitude: bases.longitude,
      date: assignments.date,
      period: assignments.period,
      shift: assignments.shift,
      status: assignments.status,
      isExtraShift: assignments.isExtraShift,
      extraShiftNotes: assignments.extraShiftNotes,
      notes: assignments.notes,
      absenceJustification: assignments.absenceJustification,
      absenceJustificationActor: assignments.absenceJustificationActor,
      absenceJustificationAt: assignments.absenceJustificationAt,
      createdAt: assignments.createdAt,
      checkinGeoValid: checkins.geoValid,
      checkinStatus: checkins.status,
      checkinMethod: checkins.method,
      checkinAt: checkins.checkinAt,
      totpValidatedAt: checkins.totpValidatedAt,
      validatedBy: checkins.validatedBy,
      validatedByName: checkins.validatedByName,
      checkoutAt: checkins.checkoutAt,
      checkoutConfirmedBy: checkins.checkoutConfirmedBy,
      checkoutConfirmedByName: checkins.checkoutConfirmedByName,
      checkoutNotes: checkins.checkoutNotes,
      internObservations: checkins.internObservations,
      preceptorObservations: checkins.preceptorObservations,
      // true quando a turma do interno já foi arquivada (cohort CLOSED).
      // Consumidores que mostram pendência operacional (faltas) filtram por isso.
      internArchived: userRoles.isArchived,
    })
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.internId))
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
    .leftJoin(checkins, eq(checkins.assignmentId, assignments.id))
    .leftJoin(userRoles, and(
      eq(userRoles.userId, assignments.internId),
      eq(userRoles.facultyId, assignments.facultyId),
      eq(userRoles.role, "INTERN"),
    ))
    .orderBy(assignments.date, assignments.period)
    .$dynamic();

  const conditions = [];
  if (params.dateFrom) conditions.push(gte(assignments.date, params.dateFrom));
  if (params.dateTo) conditions.push(lte(assignments.date, params.dateTo));
  if (params.facultyId) conditions.push(eq(assignments.facultyId, params.facultyId));
  if (params.baseId) conditions.push(eq(assignments.baseId, params.baseId));
  if (params.period) conditions.push(eq(assignments.period, params.period));
  if (params.internId) conditions.push(eq(assignments.internId, params.internId));
  if (params.selfOnlyUserId) conditions.push(eq(assignments.internId, params.selfOnlyUserId));

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  return query;
}

export async function findAssignmentForReassign(assignmentId: string) {
  const [assignment] = await db
    .select({
      id: assignments.id,
      internId: assignments.internId,
      facultyId: assignments.facultyId,
      baseId: assignments.baseId,
      date: assignments.date,
      period: assignments.period,
      status: assignments.status,
      notes: assignments.notes,
      currentBaseCode: bases.code,
      currentBaseName: bases.name,
      currentBaseType: bases.type,
      checkinStatus: checkins.status,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .leftJoin(checkins, eq(checkins.assignmentId, assignments.id))
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  return assignment;
}

export async function findBaseForReassign(baseId: string) {
  const [base] = await db
    .select({ id: bases.id, code: bases.code, name: bases.name, type: bases.type, isActive: bases.isActive })
    .from(bases)
    .where(eq(bases.id, baseId))
    .limit(1);

  return base;
}

export async function updateAssignmentBaseAndNotes(params: {
  assignmentId: string;
  baseId: string;
  notes: string | null;
}) {
  const [updated] = await db
    .update(assignments)
    .set({
      baseId: params.baseId,
      notes: params.notes,
      updatedAt: new Date(),
    })
    .where(eq(assignments.id, params.assignmentId))
    .returning();

  return updated;
}

export async function findAssignmentForAbsenceJustification(id: string) {
  const [assignment] = await db
    .select({
      id: assignments.id,
      internId: assignments.internId,
      facultyId: assignments.facultyId,
      status: assignments.status,
      date: assignments.date,
      period: assignments.period,
    })
    .from(assignments)
    .where(eq(assignments.id, id))
    .limit(1);

  return assignment;
}

export async function saveAbsenceJustification(params: {
  assignmentId: string;
  justification: string;
  actor: "INTERN" | "LEADER" | "COORDINATOR";
}) {
  const now = new Date();
  const [updated] = await db
    .update(assignments)
    .set({
      absenceJustification: params.justification,
      absenceJustificationActor: params.actor,
      absenceJustificationAt: now,
      updatedAt: now,
    })
    .where(and(eq(assignments.id, params.assignmentId), eq(assignments.status, "ABSENT")))
    .returning({
      id: assignments.id,
      absenceJustification: assignments.absenceJustification,
      absenceJustificationActor: assignments.absenceJustificationActor,
      absenceJustificationAt: assignments.absenceJustificationAt,
    });

  return updated;
}
