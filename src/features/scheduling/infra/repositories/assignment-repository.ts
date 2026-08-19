import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { assignments, faculties, userRoles } from "@/shared/db/schema";

export type ShiftValue = "MORNING" | "AFTERNOON" | null;

export async function findAssignmentByInternSlot(params: {
  internId: string;
  date: string;
  period: "DAY" | "NIGHT";
  shift: ShiftValue;
}) {
  const shiftCondition = params.shift
    ? eq(assignments.shift, params.shift)
    : sql`${assignments.shift} IS NULL`;

  const [existing] = await db
    .select({
      id: assignments.id,
      status: assignments.status,
      baseId: assignments.baseId,
      facultyId: assignments.facultyId,
      isExtraShift: assignments.isExtraShift,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.internId, params.internId),
        eq(assignments.date, params.date),
        eq(assignments.period, params.period),
        shiftCondition,
      ),
    )
    .limit(1);

  return existing;
}

export async function createAssignment(params: {
  internId: string;
  facultyId: string;
  baseId: string;
  date: string;
  period: "DAY" | "NIGHT";
  shift: ShiftValue;
  isExtraShift: boolean;
  extraShiftNotes: string | null;
  notes: string | null;
  createdBy: string;
}) {
  const [created] = await db
    .insert(assignments)
    .values({
      internId: params.internId,
      facultyId: params.facultyId,
      baseId: params.baseId,
      date: params.date,
      period: params.period,
      shift: params.shift,
      isExtraShift: params.isExtraShift,
      extraShiftNotes: params.extraShiftNotes,
      notes: params.notes,
      createdBy: params.createdBy,
    })
    .returning();

  return created;
}

export async function reactivateAssignment(params: {
  id: string;
  facultyId: string;
  baseId: string;
  shift: ShiftValue;
  isExtraShift: boolean;
  extraShiftNotes: string | null;
  notes: string | null;
}) {
  const [updated] = await db
    .update(assignments)
    .set({
      facultyId: params.facultyId,
      baseId: params.baseId,
      shift: params.shift,
      status: "SCHEDULED",
      isExtraShift: params.isExtraShift,
      extraShiftNotes: params.extraShiftNotes,
      notes: params.notes,
      updatedAt: new Date(),
    })
    .where(eq(assignments.id, params.id))
    .returning();

  return updated;
}

export async function findAssignmentFacultyById(id: string) {
  const [target] = await db
    .select({ facultyId: assignments.facultyId })
    .from(assignments)
    .where(eq(assignments.id, id));

  return target;
}

export async function updateAssignmentStatus(params: {
  id: string;
  status: string;
  notes?: string;
}) {
  const [updated] = await db
    .update(assignments)
    .set({
      status: params.status as "SCHEDULED" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "ABSENT" | "CANCELLED" | "EXCUSED",
      notes: params.notes,
      updatedAt: new Date(),
    })
    .where(eq(assignments.id, params.id))
    .returning();

  return updated;
}

export async function countNonCancelledForSlot(params: {
  baseId: string;
  date: string;
  period: "DAY" | "NIGHT";
  facultyId: string;
}) {
  const [result] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(assignments)
    .where(
      and(
        eq(assignments.baseId, params.baseId),
        eq(assignments.date, params.date),
        eq(assignments.period, params.period),
        eq(assignments.facultyId, params.facultyId),
        ne(assignments.status, "CANCELLED"),
      ),
    );

  return Number(result?.count ?? 0);
}

export async function getFacultyAbbreviationById(facultyId: string) {
  const [facultyRow] = await db
    .select({ abbreviation: faculties.abbreviation })
    .from(faculties)
    .where(eq(faculties.id, facultyId))
    .limit(1);

  return facultyRow?.abbreviation ?? null;
}

export async function getInternPrimaryFacultyId(internId: string): Promise<string | null> {
  const [row] = await db
    .select({ facultyId: userRoles.facultyId })
    .from(userRoles)
    .where(and(eq(userRoles.userId, internId), eq(userRoles.role, "INTERN"), eq(userRoles.isActive, true)))
    .limit(1);

  return row?.facultyId ?? null;
}
