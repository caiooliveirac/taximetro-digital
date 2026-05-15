import { db } from "@/shared/db/client";
import { cohorts, faculties, userRoles, users } from "@/db/schema";
import { eq, and, inArray, isNull, ne } from "drizzle-orm";

export async function listCohorts(filters?: {
  facultyId?: string;
  status?: ("PLANNED" | "ACTIVE" | "CLOSED")[];
}) {
  const conditions = [];
  if (filters?.facultyId) conditions.push(eq(cohorts.facultyId, filters.facultyId));
  if (filters?.status?.length) conditions.push(inArray(cohorts.status, filters.status));

  return db
    .select({
      id: cohorts.id,
      facultyId: cohorts.facultyId,
      facultyName: faculties.name,
      facultyAbbreviation: faculties.abbreviation,
      rotationNumber: cohorts.rotationNumber,
      startDate: cohorts.startDate,
      endDate: cohorts.endDate,
      name: cohorts.name,
      label: cohorts.label,
      status: cohorts.status,
      closedAt: cohorts.closedAt,
      notes: cohorts.notes,
      createdAt: cohorts.createdAt,
    })
    .from(cohorts)
    .leftJoin(faculties, eq(cohorts.facultyId, faculties.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(cohorts.startDate);
}

export async function getCohortById(id: string) {
  const rows = await db
    .select()
    .from(cohorts)
    .where(eq(cohorts.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createCohort(input: {
  facultyId: string;
  rotationNumber: number;
  startDate: string;
  endDate: string;
  name?: string;
  label: string;
  notes?: string;
  createdBy: string;
}) {
  const rows = await db
    .insert(cohorts)
    .values({
      facultyId: input.facultyId,
      rotationNumber: input.rotationNumber,
      startDate: input.startDate,
      endDate: input.endDate,
      name: input.name,
      label: input.label,
      notes: input.notes,
      createdBy: input.createdBy,
    })
    .returning();
  return rows[0];
}

export async function updateCohort(
  id: string,
  input: Partial<{
    startDate: string;
    endDate: string;
    name: string;
    label: string;
    status: "PLANNED" | "ACTIVE" | "CLOSED";
    notes: string;
  }>
) {
  const rows = await db
    .update(cohorts)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(cohorts.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteCohort(id: string) {
  await db.delete(cohorts).where(eq(cohorts.id, id));
}

// F2: intern ↔ cohort assignment

export async function listInternsWithoutCohort(facultyId: string) {
  return db
    .select({
      userRoleId: userRoles.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      isArchived: userRoles.isArchived,
    })
    .from(userRoles)
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(
      and(
        eq(userRoles.facultyId, facultyId),
        eq(userRoles.role, "INTERN"),
        eq(userRoles.isArchived, false),
        isNull(userRoles.cohortId),
      ),
    )
    .orderBy(users.name);
}

export async function getUserRoleFacultyIds(userRoleIds: string[]): Promise<{ id: string; facultyId: string | null }[]> {
  if (userRoleIds.length === 0) return [];
  return db
    .select({ id: userRoles.id, facultyId: userRoles.facultyId })
    .from(userRoles)
    .where(inArray(userRoles.id, userRoleIds));
}

export async function bulkAssignCohort(userRoleIds: string[], cohortId: string) {
  if (userRoleIds.length === 0) return;
  await db
    .update(userRoles)
    .set({ cohortId })
    .where(inArray(userRoles.id, userRoleIds));
}

export async function listInternsByCohort(cohortId: string) {
  return db
    .select({
      userRoleId: userRoles.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      isArchived: userRoles.isArchived,
    })
    .from(userRoles)
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(eq(userRoles.cohortId, cohortId))
    .orderBy(users.name);
}

export async function unassignCohort(userRoleId: string) {
  await db
    .update(userRoles)
    .set({ cohortId: null })
    .where(eq(userRoles.id, userRoleId));
}

// F3: lifecycle por datas (start/end)

/** Turmas ainda não fechadas — candidatas a transição automática de status. */
export async function listCohortsForLifecycle(cohortId?: string) {
  const conditions = [ne(cohorts.status, "CLOSED")];
  if (cohortId) conditions.push(eq(cohorts.id, cohortId));
  return db
    .select({
      id: cohorts.id,
      label: cohorts.label,
      name: cohorts.name,
      status: cohorts.status,
      startDate: cohorts.startDate,
      endDate: cohorts.endDate,
    })
    .from(cohorts)
    .where(and(...conditions));
}

/** Marca uma turma como ACTIVE (promoção PLANNED → ACTIVE). */
export async function activateCohort(cohortId: string) {
  await db
    .update(cohorts)
    .set({ status: "ACTIVE", updatedAt: new Date() })
    .where(eq(cohorts.id, cohortId));
}

/**
 * Fecha uma turma e arquiva todos os internos ainda ativos nela.
 * Idempotente: internos já arquivados não são tocados.
 * Retorna a quantidade de internos arquivados nesta chamada.
 */
export async function closeCohortAndArchiveInterns(params: {
  cohortId: string;
  closedBy: string | null;
}): Promise<number> {
  const now = new Date();

  await db
    .update(cohorts)
    .set({ status: "CLOSED", closedAt: now, closedBy: params.closedBy, updatedAt: now })
    .where(eq(cohorts.id, params.cohortId));

  const archived = await db
    .update(userRoles)
    .set({ isArchived: true, archivedAt: now, archivedBy: params.closedBy })
    .where(
      and(
        eq(userRoles.cohortId, params.cohortId),
        eq(userRoles.role, "INTERN"),
        eq(userRoles.isArchived, false),
      ),
    )
    .returning({ id: userRoles.id });

  return archived.length;
}
