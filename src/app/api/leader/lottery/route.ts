import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { slotRules, assignments, bases, userRoles } from "@/db/schema";
import { eq, and, gte, lte, ne, inArray } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { getCruBlockedSlots } from "@/lib/slots";
import { getEffectiveUser } from "@/lib/impersonate";
import { z } from "zod/v4";

/**
 * Base priority for the lottery (DAY shifts fill first, then in this order).
 * Bases at the END of the list are the first to stay empty if there aren't enough interns.
 */
const BASE_PRIORITY = [
  "SM01", "PM04", "PM40", "CN10", "PR03", "CC70",
  "BR60", "CB02", "IT30", "CZ50", "BR05", "PP20",
];

const DOW_INDEX: Record<string, number> = {
  MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6,
};

const lotterySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  internIds: z.array(z.string().uuid()).min(1),
  maxShifts: z.number().int().min(1).max(7).default(1),
});

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "LEADER") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const facultyId = user.facultyId;
  if (!facultyId) {
    return NextResponse.json({ success: false, error: "Líder sem faculdade vinculada" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = lotterySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const { weekStart, internIds, maxShifts } = parsed.data;

  /* ── Validate intern ownership ── */
  const validRows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.facultyId, facultyId),
        eq(userRoles.role, "INTERN"),
        eq(userRoles.isActive, true),
        inArray(userRoles.userId, internIds),
      ),
    );
  const validIds = new Set(validRows.map((r) => r.userId));
  const safeIds = internIds.filter((id) => validIds.has(id));
  if (safeIds.length === 0) {
    return NextResponse.json({ success: false, error: "Nenhum interno válido selecionado" }, { status: 400 });
  }

  /* ── Week dates (weekStart = monday) ── */
  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    weekDates.push(d.toISOString().slice(0, 10));
  }

  /* ── Slot rules for this faculty ── */
  const rules = await db
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

  /* ── Existing assignments this week ── */
  const existing = await db
    .select({
      internId: assignments.internId,
      baseId: assignments.baseId,
      date: assignments.date,
      period: assignments.period,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.facultyId, facultyId),
        gte(assignments.date, weekDates[0]),
        lte(assignments.date, weekDates[6]),
        ne(assignments.status, "CANCELLED"),
      ),
    );

  /* ── Build list of open positions ── */
  type Pos = { baseId: string; baseCode: string; baseType: string; date: string; period: "DAY" | "NIGHT" };
  const positions: Pos[] = [];

  for (const rule of rules) {
    const dayIdx = DOW_INDEX[rule.dayOfWeek];
    if (dayIdx === undefined) continue;
    const dateStr = weekDates[dayIdx];
    if (!dateStr) continue;

    const filled = existing.filter(
      (a) => a.baseId === rule.baseId && a.date === dateStr && a.period === rule.period,
    ).length;

    for (let j = 0; j < rule.capacity - filled; j++) {
      positions.push({
        baseId: rule.baseId,
        baseCode: rule.baseCode,
        baseType: rule.baseType,
        date: dateStr,
        period: rule.period as "DAY" | "NIGHT",
      });
    }
  }

  /* ── Sort: DAY first → base priority ── */
  positions.sort((a, b) => {
    if (a.period !== b.period) return a.period === "DAY" ? -1 : 1;
    const ai = BASE_PRIORITY.indexOf(a.baseCode);
    const bi = BASE_PRIORITY.indexOf(b.baseCode);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  /* ── Shuffle interns (Fisher-Yates) ── */
  const shuffled = [...safeIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  /* ── Track date|period already used per intern ── */
  const usedSlots = new Map<string, Set<string>>();
  for (const id of safeIds) usedSlots.set(id, new Set());
  for (const a of existing) {
    if (usedSlots.has(a.internId)) {
      usedSlots.get(a.internId)!.add(`${a.date}|${a.period}`);
    }
  }

  /* ── CRU ±12h blocked slots ── */
  const cruBlocked = await getCruBlockedSlots(safeIds, weekDates[0], weekDates[6]);

  /* ── Count existing shifts per intern (towards maxShifts) ── */
  const existingShiftCount = new Map<string, number>();
  for (const id of safeIds) existingShiftCount.set(id, 0);
  for (const a of existing) {
    if (existingShiftCount.has(a.internId)) {
      existingShiftCount.set(a.internId, (existingShiftCount.get(a.internId) ?? 0) + 1);
    }
  }

  /**
   * Smart round-robin allocation with maxShifts limit.
   * Instead of filling ALL positions greedily, we do multiple rounds:
   * Round 1: give each intern their 1st shift
   * Round 2: give each intern their 2nd shift (if maxShifts >= 2)
   * ... up to maxShifts rounds
   * This ensures fair distribution before filling extra capacity.
   */

  function canAssign(internId: string, pos: Pos, shiftCount: number): boolean {
    const key = `${pos.date}|${pos.period}`;
    if (usedSlots.get(internId)?.has(key)) return false;
    if (cruBlocked.get(internId)?.has(key)) return false;
    if (shiftCount >= maxShifts) return false;
    return true;
  }

  function addCruBlocking(internId: string, pos: Pos) {
    if (pos.baseType !== "CENTRAL") return;
    if (!cruBlocked.has(internId)) cruBlocked.set(internId, new Set());
    const blocked = cruBlocked.get(internId)!;
    const key = `${pos.date}|${pos.period}`;
    blocked.add(key);
    if (pos.period === "DAY") {
      const prevDay = new Date(pos.date + "T12:00:00Z");
      prevDay.setUTCDate(prevDay.getUTCDate() - 1);
      blocked.add(`${prevDay.toISOString().slice(0, 10)}|NIGHT`);
      blocked.add(`${pos.date}|NIGHT`);
    } else {
      const nextDay = new Date(pos.date + "T12:00:00Z");
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      blocked.add(`${pos.date}|DAY`);
      blocked.add(`${nextDay.toISOString().slice(0, 10)}|DAY`);
    }
  }

  const toCreate: {
    internId: string; facultyId: string; baseId: string;
    date: string; period: "DAY" | "NIGHT"; createdBy: string;
  }[] = [];

  // Track new shifts per intern in this lottery
  const newShiftCount = new Map<string, number>();
  for (const id of safeIds) newShiftCount.set(id, 0);

  // Track which positions are still available (index → taken)
  const positionTaken = new Array(positions.length).fill(false);

  // Round-robin across maxShifts rounds
  for (let round = 0; round < maxShifts; round++) {
    // Each round: iterate shuffled interns, each gets at most 1 shift
    for (const internId of shuffled) {
      const totalShifts = (existingShiftCount.get(internId) ?? 0) + (newShiftCount.get(internId) ?? 0);
      if (totalShifts >= maxShifts) continue;

      // Find best available position for this intern
      // Prefer CRU first (harder to fill), then by base priority
      let bestIdx = -1;
      for (let i = 0; i < positions.length; i++) {
        if (positionTaken[i]) continue;
        if (!canAssign(internId, positions[i], totalShifts)) continue;
        bestIdx = i;
        break;
      }

      if (bestIdx === -1) continue;

      const pos = positions[bestIdx];
      const key = `${pos.date}|${pos.period}`;

      positionTaken[bestIdx] = true;
      usedSlots.get(internId)!.add(key);
      newShiftCount.set(internId, (newShiftCount.get(internId) ?? 0) + 1);
      addCruBlocking(internId, pos);

      toCreate.push({
        internId,
        facultyId,
        baseId: pos.baseId,
        date: pos.date,
        period: pos.period,
        createdBy: user.realUserId ?? user.id,
      });
    }
  }

  /* ── Batch insert (skip conflicts) ── */
  if (toCreate.length > 0) {
    await db.insert(assignments).values(toCreate).onConflictDoNothing();
    await logAudit({
      userId: user.realUserId ?? user.id,
      action: "LOTTERY",
      entity: "assignment",
      entityId: toCreate[0].internId,
      payload: { weekStart, maxShifts, selected: safeIds.length, created: toCreate.length, ...(user.isImpersonating ? { impersonating: user.id } : {}) },
    });
  }

  // Count how many interns got assignments
  const internsAllocated = new Set(toCreate.map((t) => t.internId)).size;
  const remainingPositions = positionTaken.filter((t) => !t).length;

  return NextResponse.json({
    success: true,
    data: {
      total: toCreate.length,
      weekStart,
      maxShifts,
      internsAllocated,
      internsTotal: safeIds.length,
      remainingPositions,
    },
  });
}
