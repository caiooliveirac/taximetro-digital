import { db } from "@/db";
import { slotRules, assignments, bases, faculties, requests } from "@/db/schema";
import { eq, and, sql, ne, gte, lte, inArray } from "drizzle-orm";
import { addDaysToDateStr, localDateStr } from "@/lib/utils";
import { computePeriodLoad } from "@/features/scheduling/domain/policies/assignment-policy";

function normalizeDateKey(date: string): string {
  return date.slice(0, 10);
}

export async function getAvailableSlots(facultyId?: string, weekStart?: string) {
  const rangeStart = weekStart ?? localDateStr();
  const rangeEnd = addDaysToDateStr(rangeStart, 6);
  const isoDow = sql<number>`CASE ${slotRules.dayOfWeek}
    WHEN 'MON' THEN 1
    WHEN 'TUE' THEN 2
    WHEN 'WED' THEN 3
    WHEN 'THU' THEN 4
    WHEN 'FRI' THEN 5
    WHEN 'SAT' THEN 6
    WHEN 'SUN' THEN 7
  END`;

  // Find the occurrence of each day-of-week inside the requested week
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
      isExtraShift: slotRules.isExtraShift,
      nextDate: sql<string>`(
        SELECT d::date::text FROM generate_series(
          ${rangeStart}::date,
          ${rangeEnd}::date,
          '1 day'
        ) d
        WHERE EXTRACT(ISODOW FROM d) = ${isoDow}
        LIMIT 1
      )`.as("next_date"),
      filled: sql<number>`COALESCE(
        (SELECT COUNT(*) FROM assignments a
         WHERE a.base_id = ${slotRules.baseId}
           AND a.period = ${slotRules.period}
           AND a.faculty_id = ${slotRules.facultyId}
           AND a.status NOT IN ('CANCELLED', 'ABSENT')
           AND a.is_extra_shift = false
           AND a.date = (
             SELECT d::date FROM generate_series(
               ${rangeStart}::date,
               ${rangeEnd}::date,
               '1 day'
             ) d
             WHERE EXTRACT(ISODOW FROM d) = ${isoDow}
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

  const deduped = new Map<string, {
    ruleId: string;
    baseId: string;
    baseCode: string;
    baseName: string;
    baseType: string;
    dayOfWeek: string;
    period: string;
    facultyId: string;
    facultyAbbr: string;
    capacity: number;
    isExtraShift: boolean;
    nextDate: string;
    filled: number;
  }>();

  for (const row of rows) {
    if (!row.nextDate) continue;

    const key = `${row.baseId}|${row.nextDate}|${row.period}|${row.facultyId}`;
    const current = deduped.get(key);
    if (current) {
      current.capacity += row.capacity;
      current.filled += Number(row.filled);
      continue;
    }
    deduped.set(key, {
      ...row,
      filled: Number(row.filled),
    });
  }

  return Array.from(deduped.values())
    .map((r) => ({
      ...r,
      available: r.capacity - Number(r.filled),
    }))
    .sort((left, right) => {
      const byDate = left.nextDate.localeCompare(right.nextDate);
      if (byDate !== 0) return byDate;

      if (left.period !== right.period) {
        return left.period === "DAY" ? -1 : 1;
      }

      return left.baseCode.localeCompare(right.baseCode);
    });
}

export async function getRequestableSlots(facultyId: string, internId: string) {
  const slots = (await getAvailableSlots(facultyId)).filter((slot) => slot.available > 0 && Boolean(slot.nextDate));
  if (slots.length === 0) return [];

  const slotDates = [...new Set(slots.map((slot) => slot.nextDate))].sort();
  const firstDate = slotDates[0];
  const lastDate = slotDates[slotDates.length - 1];

  const activeAssignments = await db
    .select({
      date: assignments.date,
      period: assignments.period,
      shift: assignments.shift,
    })
    .from(assignments)
    .where(and(
      eq(assignments.internId, internId),
      gte(assignments.date, firstDate),
      lte(assignments.date, lastDate),
      ne(assignments.status, "CANCELLED"),
    ));

  // For EBMSP (shift-based): only block if BOTH shifts are taken
  const blockedByAssignment = new Set<string>();
  const shiftsByDatePeriod = new Map<string, Set<string>>();
  for (const a of activeAssignments) {
    const key = `${a.date}|${a.period}`;
    if (a.shift) {
      if (!shiftsByDatePeriod.has(key)) shiftsByDatePeriod.set(key, new Set());
      shiftsByDatePeriod.get(key)!.add(a.shift);
    } else {
      // Non-shift assignment: fully blocks the slot
      blockedByAssignment.add(key);
    }
  }
  // Block only if both MORNING and AFTERNOON are taken
  for (const [key, shifts] of shiftsByDatePeriod) {
    if (shifts.has("MORNING") && shifts.has("AFTERNOON")) {
      blockedByAssignment.add(key);
    }
  }

  const pendingExtraRequests = await db
    .select({
      date: requests.extraDate,
      period: requests.extraPeriod,
    })
    .from(requests)
    .where(and(
      eq(requests.requesterId, internId),
      eq(requests.type, "EXTRA_SHIFT"),
      inArray(requests.status, ["PENDING", "ESCALATED"]),
      gte(requests.extraDate, firstDate),
      lte(requests.extraDate, lastDate),
    ));

  const blockedByPendingExtra = new Set(
    pendingExtraRequests
      .filter((request) => request.date && request.period)
      .map((request) => `${request.date}|${request.period}`),
  );

  const cruBlocked = await getCruBlockedSlots([internId], firstDate, lastDate);
  const blockedByCru = cruBlocked.get(internId) ?? new Set<string>();

  return slots.filter((slot) => {
    const key = `${slot.nextDate}|${slot.period}`;
    if (blockedByAssignment.has(key)) return false;
    if (blockedByPendingExtra.has(key)) return false;
    if (blockedByCru.has(key)) return false;
    return true;
  });
}

export async function checkSlotAvailability(
  baseId: string,
  date: string,
  period: "DAY" | "NIGHT",
  facultyId: string,
  shift?: string | null,
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

  // When shift is provided (EBMSP), count only same-shift assignments.
  // Each shift gets the full slot capacity (capacity=1 → 1 MORNING + 1 AFTERNOON).
  const conditions = [
    eq(assignments.baseId, baseId),
    eq(assignments.date, date),
    eq(assignments.period, period),
    eq(assignments.facultyId, facultyId),
    ne(assignments.status, "CANCELLED"),
    ne(assignments.status, "ABSENT"),
    eq(assignments.isExtraShift, false),
  ];
  if (shift) {
    conditions.push(eq(assignments.shift, shift));
  }

  const [result] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(assignments)
    .where(and(...conditions));

  const assigned = Number(result?.count ?? 0);
  return { available: assigned < rule.capacity, capacity: rule.capacity, assigned };
}

/**
 * Quantos internos já estão na base naquele turno, contra a soma das vagas da
 * grade (todas as faculdades). É o teto duro: nenhum caminho de alocação —
 * grade, alocação livre do admin, remanejamento ou sorteio — pode furar.
 *
 * Só vale para base USA, onde o teto é físico (uma viatura, dois internos).
 * CRU e CRL se limitam pela grade e às vezes abrem mais de dez vagas por
 * faculdade — lá não há teto a aplicar.
 *
 * Plantão extra não conta: é vaga publicada por fora da grade, com autorização
 * explícita, e a grade dele já é validada em outro lugar.
 */
export async function checkPeriodOccupancy(
  baseId: string,
  date: string,
  period: "DAY" | "NIGHT",
  excludeAssignmentId?: string,
): Promise<ReturnType<typeof computePeriodLoad>> {
  const dayOfWeek = getDayOfWeek(date);

  const [base] = await db
    .select({ type: bases.type })
    .from(bases)
    .where(eq(bases.id, baseId))
    .limit(1);

  // capacity 0 = sem teto a aplicar.
  if (base?.type !== "USA") return computePeriodLoad({ capacity: 0, occupied: 0 });

  const [capacityRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${slotRules.capacity}), 0)` })
    .from(slotRules)
    .where(
      and(
        eq(slotRules.baseId, baseId),
        eq(slotRules.dayOfWeek, dayOfWeek),
        eq(slotRules.period, period),
        eq(slotRules.isActive, true),
        eq(slotRules.isBlocked, false),
        eq(slotRules.isExtraShift, false),
      ),
    );

  const conditions = [
    eq(assignments.baseId, baseId),
    eq(assignments.date, date),
    eq(assignments.period, period),
    ne(assignments.status, "CANCELLED"),
    ne(assignments.status, "ABSENT"),
    eq(assignments.isExtraShift, false),
  ];
  if (excludeAssignmentId) conditions.push(ne(assignments.id, excludeAssignmentId));

  // Turno partido (manhã/tarde) é coisa da EBMSP no CRU, que nem chega aqui.
  const [occupiedRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(assignments)
    .where(and(...conditions));

  return computePeriodLoad({
    capacity: Number(capacityRow?.total ?? 0),
    occupied: Number(occupiedRow?.count ?? 0),
  });
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
  const normalizedDate = normalizeDateKey(date);
  if (period === "DAY") {
    return [
      `${addDaysToDateStr(normalizedDate, -1)}|NIGHT`,
      `${normalizedDate}|NIGHT`,
    ];
  }
  return [
    `${normalizedDate}|DAY`,
    `${addDaysToDateStr(normalizedDate, 1)}|DAY`,
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

  const from = addDaysToDateStr(dateFrom, -1);
  const to = addDaysToDateStr(dateTo, 1);

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
        inArray(bases.code, ["CRU", "CRL"]),
        inArray(assignments.internId, internIds),
        gte(assignments.date, from),
        lte(assignments.date, to),
        ne(assignments.status, "CANCELLED"),
      ),
    );

  for (const a of cruAssignments) {
    if (!blocked.has(a.internId)) blocked.set(a.internId, new Set());
    const set = blocked.get(a.internId)!;
    const normalizedDate = normalizeDateKey(a.date);
    // The CRU assignment itself blocks that slot
    set.add(`${normalizedDate}|${a.period}`);
    // Plus adjacent slots
    for (const s of getAdjacentBlockedSlots(normalizedDate, a.period as "DAY" | "NIGHT")) {
      set.add(s);
    }
  }

  return blocked;
}

/**
 * Check if a single intern has a CRU conflict for a specific date+period.
 * CRU/CRL targets are exempt — the rule only blocks USA assignments adjacent to CRU/CRL.
 * Returns { conflicted: boolean, reason?: string }
 */
export async function checkCruConflict(
  internId: string,
  date: string,
  period: "DAY" | "NIGHT",
  excludeAssignmentId?: string,
  targetBaseId?: string,
): Promise<{ conflicted: boolean; reason?: string }> {
  // If the target base is CRU/CRL itself, skip ±12h conflict (CRU doesn't conflict with CRU)
  if (targetBaseId) {
    const [targetBase] = await db
      .select({ code: bases.code })
      .from(bases)
      .where(eq(bases.id, targetBaseId))
      .limit(1);
    if (targetBase && (targetBase.code === "CRU" || targetBase.code === "CRL")) {
      return { conflicted: false };
    }
  }
  const from = addDaysToDateStr(date, -1);
  const to = addDaysToDateStr(date, 1);
  const normalizedTargetDate = normalizeDateKey(date);

  const conditions = [
    inArray(bases.code, ["CRU", "CRL"]),
    eq(assignments.internId, internId),
    gte(assignments.date, from),
    lte(assignments.date, to),
    ne(assignments.status, "CANCELLED"),
  ];

  if (excludeAssignmentId) {
    conditions.push(ne(assignments.id, excludeAssignmentId));
  }

  const cruAssignments = await db
    .select({ date: assignments.date, period: assignments.period })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .where(and(...conditions));

  const blocked = new Set<string>();
  for (const assignment of cruAssignments) {
    const normalizedDate = normalizeDateKey(assignment.date);
    blocked.add(`${normalizedDate}|${assignment.period}`);
    for (const slot of getAdjacentBlockedSlots(normalizedDate, assignment.period as "DAY" | "NIGHT")) {
      blocked.add(slot);
    }
  }

  if (blocked.has(`${normalizedTargetDate}|${period}`)) {
    return { conflicted: true, reason: "Conflito: interno possui plantão em regulação (CRU/CRL) em turno adjacente (±12h)" };
  }
  return { conflicted: false };
}
