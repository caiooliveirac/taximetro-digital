import { eq } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { bases, faculties, slotRules } from "@/shared/db/schema";

export async function listSlotRules() {
  return db
    .select({
      id: slotRules.id,
      baseId: slotRules.baseId,
      baseCode: bases.code,
      baseName: bases.name,
      dayOfWeek: slotRules.dayOfWeek,
      period: slotRules.period,
      facultyId: slotRules.facultyId,
      facultyAbbr: faculties.abbreviation,
      capacity: slotRules.capacity,
      isActive: slotRules.isActive,
      isExtraShift: slotRules.isExtraShift,
    })
    .from(slotRules)
    .innerJoin(bases, eq(bases.id, slotRules.baseId))
    .innerJoin(faculties, eq(faculties.id, slotRules.facultyId))
    .orderBy(bases.code, slotRules.dayOfWeek, slotRules.period);
}

export async function createSlotRule(values: {
  baseId: string;
  dayOfWeek: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
  period: "DAY" | "NIGHT";
  facultyId: string;
  capacity: number;
  isActive: boolean;
  isExtraShift: boolean;
}) {
  const [created] = await db
    .insert(slotRules)
    .values(values)
    .onConflictDoUpdate({
      target: [slotRules.baseId, slotRules.dayOfWeek, slotRules.period, slotRules.facultyId],
      set: {
        capacity: values.capacity,
        isActive: true,
        isExtraShift: values.isExtraShift,
      },
    })
    .returning();
  return created;
}

export async function updateSlotRuleById(params: {
  id: string;
  values: Partial<{
    baseId: string;
    dayOfWeek: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
    period: "DAY" | "NIGHT";
    facultyId: string;
    capacity: number;
    isActive: boolean;
    isExtraShift: boolean;
  }>;
}) {
  const [updated] = await db.update(slotRules).set(params.values).where(eq(slotRules.id, params.id)).returning();
  return updated;
}

export async function softDeleteSlotRule(id: string) {
  const [deleted] = await db.update(slotRules).set({ isActive: false }).where(eq(slotRules.id, id)).returning();
  return deleted;
}
