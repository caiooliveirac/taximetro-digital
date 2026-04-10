import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { assignments, bases, faculties, slotRules, userRoles } from "@/shared/db/schema";

export async function getValidInternIdsForFaculty(params: {
  facultyId: string;
  internIds: string[];
}) {
  const validRows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.facultyId, params.facultyId),
        inArray(userRoles.role, ["INTERN", "LEADER"]),
        eq(userRoles.isActive, true),
        inArray(userRoles.userId, params.internIds),
      ),
    );

  return new Set(validRows.map((row) => row.userId));
}

export async function getSlotRulesForFaculty(facultyId: string) {
  return db
    .select({
      id: slotRules.id,
      baseId: slotRules.baseId,
      baseCode: bases.code,
      baseType: bases.type,
      dayOfWeek: slotRules.dayOfWeek,
      period: slotRules.period,
      capacity: slotRules.capacity,
    })
    .from(slotRules)
    .innerJoin(bases, eq(bases.id, slotRules.baseId))
    .where(and(eq(slotRules.facultyId, facultyId), eq(slotRules.isActive, true)));
}

export async function getExistingAssignmentsForWeek(params: {
  facultyId: string;
  weekStart: string;
  weekEnd: string;
}) {
  return db
    .select({
      internId: assignments.internId,
      baseId: assignments.baseId,
      date: assignments.date,
      period: assignments.period,
      shift: assignments.shift,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.facultyId, params.facultyId),
        gte(assignments.date, params.weekStart),
        lte(assignments.date, params.weekEnd),
        ne(assignments.status, "CANCELLED"),
      ),
    );
}

export async function getFacultyAbbreviation(facultyId: string) {
  const [facultyRow] = await db
    .select({ abbreviation: faculties.abbreviation })
    .from(faculties)
    .where(eq(faculties.id, facultyId))
    .limit(1);

  return facultyRow?.abbreviation ?? null;
}

export async function insertLotteryAssignments(values: Array<{
  internId: string;
  facultyId: string;
  baseId: string;
  date: string;
  period: "DAY" | "NIGHT";
  shift: string | null;
  createdBy: string;
}>) {
  if (values.length === 0) return;
  await db.insert(assignments).values(values).onConflictDoNothing();
}
