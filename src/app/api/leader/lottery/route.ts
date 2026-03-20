import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { slotRules, assignments, bases, userRoles } from "@/db/schema";
import { eq, and, gte, lte, ne, inArray } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
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
});

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || token.role !== "LEADER") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const facultyId = token.facultyId as string;
  if (!facultyId) {
    return NextResponse.json({ success: false, error: "Líder sem faculdade vinculada" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = lotterySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const { weekStart, internIds } = parsed.data;

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
  type Pos = { baseId: string; baseCode: string; date: string; period: "DAY" | "NIGHT" };
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

  /* ── Assign picking intern with fewest shifts so far ── */
  const toCreate: {
    internId: string; facultyId: string; baseId: string;
    date: string; period: "DAY" | "NIGHT"; createdBy: string;
  }[] = [];

  for (const pos of positions) {
    const key = `${pos.date}|${pos.period}`;
    const candidates = shuffled.filter((id) => !usedSlots.get(id)?.has(key));
    if (candidates.length === 0) continue;

    const pick = candidates.reduce((best, id) =>
      (usedSlots.get(id)?.size ?? 0) < (usedSlots.get(best)?.size ?? 0) ? id : best,
    );

    usedSlots.get(pick)!.add(key);
    toCreate.push({
      internId: pick,
      facultyId,
      baseId: pos.baseId,
      date: pos.date,
      period: pos.period,
      createdBy: token.id as string,
    });
  }

  /* ── Batch insert (skip conflicts) ── */
  if (toCreate.length > 0) {
    await db.insert(assignments).values(toCreate).onConflictDoNothing();
    await logAudit({
      userId: token.id as string,
      action: "LOTTERY",
      entity: "assignment",
      entityId: toCreate[0].internId,
      payload: { weekStart, selected: safeIds.length, created: toCreate.length },
    });
  }

  return NextResponse.json({
    success: true,
    data: { total: toCreate.length, weekStart },
  });
}
