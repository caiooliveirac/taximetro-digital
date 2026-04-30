import { db } from "@/shared/db/client";
import { cohorts, faculties } from "@/db/schema";
import { eq, and, or, inArray } from "drizzle-orm";

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
