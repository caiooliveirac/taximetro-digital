import { db } from "@/db";
import { slotRules, assignments, bases, faculties } from "@/db/schema";
import { eq, and, sql, ne, gte } from "drizzle-orm";

export async function getAvailableSlots(facultyId?: string) {
  const today = new Date().toISOString().slice(0, 10);

  // Find next occurrence of each day-of-week from today, then count assignments for that specific date
  const query = db
    .select({
      ruleId: slotRules.id,
      baseId: slotRules.baseId,
      baseCode: bases.code,
      baseName: bases.name,
      baseType: bases.type,
      dayOfWeek: slotRules.dayOfWeek,
      period: slotRules.period,
      facultyId: slotRules.facultyId,
      facultyAbbr: faculties.abbreviation,
      capacity: slotRules.capacity,
      nextDate: sql<string>`(
        SELECT d::date::text FROM generate_series(
          ${today}::date,
          ${today}::date + INTERVAL '6 days',
          '1 day'
        ) d
        WHERE TRIM(TO_CHAR(d, 'DY')) = CASE ${slotRules.dayOfWeek}
          WHEN 'MON' THEN 'Mon' WHEN 'TUE' THEN 'Tue' WHEN 'WED' THEN 'Wed'
          WHEN 'THU' THEN 'Thu' WHEN 'FRI' THEN 'Fri' WHEN 'SAT' THEN 'Sat'
          WHEN 'SUN' THEN 'Sun' END
        LIMIT 1
      )`.as("next_date"),
      filled: sql<number>`COALESCE(
        (SELECT COUNT(*) FROM assignments a
         WHERE a.base_id = ${slotRules.baseId}
           AND a.period = ${slotRules.period}
           AND a.faculty_id = ${slotRules.facultyId}
           AND a.status NOT IN ('CANCELLED', 'ABSENT')
           AND a.date = (
             SELECT d::date FROM generate_series(
               ${today}::date,
               ${today}::date + INTERVAL '6 days',
               '1 day'
             ) d
             WHERE TRIM(TO_CHAR(d, 'DY')) = CASE ${slotRules.dayOfWeek}
               WHEN 'MON' THEN 'Mon' WHEN 'TUE' THEN 'Tue' WHEN 'WED' THEN 'Wed'
               WHEN 'THU' THEN 'Thu' WHEN 'FRI' THEN 'Fri' WHEN 'SAT' THEN 'Sat'
               WHEN 'SUN' THEN 'Sun' END
             LIMIT 1
           )),
        0
      )`.as("filled"),
    })
    .from(slotRules)
    .innerJoin(bases, eq(bases.id, slotRules.baseId))
    .innerJoin(faculties, eq(faculties.id, slotRules.facultyId))
    .$dynamic();

  const condition = facultyId
    ? and(eq(slotRules.isActive, true), eq(slotRules.facultyId, facultyId))
    : eq(slotRules.isActive, true);

  const rows = await query.where(condition);

  return rows.map((r) => ({
    ...r,
    available: r.capacity - Number(r.filled),
  }));
}

export async function checkSlotAvailability(
  baseId: string,
  date: string,
  period: "DAY" | "NIGHT",
  facultyId: string,
): Promise<{ available: boolean; capacity: number; assigned: number }> {
  const dayOfWeek = getDayOfWeek(date);

  const [rule] = await db
    .select()
    .from(slotRules)
    .where(
      and(
        eq(slotRules.baseId, baseId),
        eq(slotRules.dayOfWeek, dayOfWeek),
        eq(slotRules.period, period),
        eq(slotRules.facultyId, facultyId),
        eq(slotRules.isActive, true),
      ),
    )
    .limit(1);

  if (!rule) return { available: false, capacity: 0, assigned: 0 };

  const [result] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(assignments)
    .where(
      and(
        eq(assignments.baseId, baseId),
        eq(assignments.date, date),
        eq(assignments.period, period),
        eq(assignments.facultyId, facultyId),
        ne(assignments.status, "CANCELLED"),
        ne(assignments.status, "ABSENT"),
      ),
    );

  const assigned = Number(result?.count ?? 0);
  return { available: assigned < rule.capacity, capacity: rule.capacity, assigned };
}

function getDayOfWeek(dateStr: string): "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN" {
  const day = new Date(dateStr + "T12:00:00").getDay();
  return (["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const)[day];
}
