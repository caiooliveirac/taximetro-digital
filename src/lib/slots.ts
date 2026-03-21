import { db } from "@/db";
import { slotRules, assignments, bases, faculties } from "@/db/schema";
import { eq, and, sql, ne, gte, lte, inArray } from "drizzle-orm";

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

// ==================== CRU ±12h CONFLICT ====================

/**
 * Given a CRU assignment (date + period), return the adjacent slots that are blocked.
 * CRU DAY on date X → blocks: (X-1 NIGHT) and (X NIGHT)
 * CRU NIGHT on date X → blocks: (X DAY) and (X+1 DAY)
 */
function getAdjacentBlockedSlots(date: string, period: "DAY" | "NIGHT"): string[] {
  const d = new Date(date + "T12:00:00Z");
  if (period === "DAY") {
    const prevDay = new Date(d);
    prevDay.setUTCDate(prevDay.getUTCDate() - 1);
    return [
      `${prevDay.toISOString().slice(0, 10)}|NIGHT`,
      `${date}|NIGHT`,
    ];
  }
  // NIGHT
  const nextDay = new Date(d);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return [
    `${date}|DAY`,
    `${nextDay.toISOString().slice(0, 10)}|DAY`,
  ];
}

/**
 * For a set of interns, find all CRU assignments in a date range
 * and return a Map of internId → Set<"date|period"> of blocked slots.
 */
export async function getCruBlockedSlots(
  internIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<Map<string, Set<string>>> {
  const blocked = new Map<string, Set<string>>();
  if (internIds.length === 0) return blocked;

  // Expand range by 1 day on each side to catch edge effects
  const from = new Date(dateFrom + "T12:00:00Z");
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(dateTo + "T12:00:00Z");
  to.setUTCDate(to.getUTCDate() + 1);

  const cruAssignments = await db
    .select({
      internId: assignments.internId,
      date: assignments.date,
      period: assignments.period,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .where(
      and(
        eq(bases.type, "CENTRAL"),
        inArray(assignments.internId, internIds),
        gte(assignments.date, from.toISOString().slice(0, 10)),
        lte(assignments.date, to.toISOString().slice(0, 10)),
        ne(assignments.status, "CANCELLED"),
      ),
    );

  for (const a of cruAssignments) {
    if (!blocked.has(a.internId)) blocked.set(a.internId, new Set());
    const set = blocked.get(a.internId)!;
    // The CRU assignment itself blocks that slot
    set.add(`${a.date}|${a.period}`);
    // Plus adjacent slots
    for (const s of getAdjacentBlockedSlots(a.date, a.period as "DAY" | "NIGHT")) {
      set.add(s);
    }
  }

  return blocked;
}

/**
 * Check if a single intern has a CRU conflict for a specific date+period.
 * Returns { conflicted: boolean, reason?: string }
 */
export async function checkCruConflict(
  internId: string,
  date: string,
  period: "DAY" | "NIGHT",
): Promise<{ conflicted: boolean; reason?: string }> {
  const blocked = await getCruBlockedSlots([internId], date, date);
  const set = blocked.get(internId);
  if (set?.has(`${date}|${period}`)) {
    return { conflicted: true, reason: "Conflito CRU: interno possui plantão na Central de Regulação em turno adjacente (±12h)" };
  }
  return { conflicted: false };
}
