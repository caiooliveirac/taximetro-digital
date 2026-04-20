import { z } from "zod/v4";
import { getCruBlockedSlots } from "@/lib/slots";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  getExistingAssignmentsForWeek,
  getFacultyAbbreviation,
  getSlotRulesForFaculty,
  getValidInternIdsForFaculty,
  insertLotteryAssignments,
} from "@/features/scheduling/infra/repositories/lottery-repository";

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

export const runLeaderLotterySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  internIds: z.array(z.string().uuid()).min(1),
  maxShifts: z.number().int().min(1).max(7).default(1),
});

export type LeaderLotteryActor = {
  id: string;
  role: string;
  facultyId: string | null;
  isImpersonating: boolean;
  realUserId: string | null;
};

type Pos = {
  baseId: string;
  baseCode: string;
  baseType: string;
  date: string;
  period: "DAY" | "NIGHT";
  shift: string | null;
};

export async function executeRunLeaderLottery(params: {
  actor: LeaderLotteryActor;
  input: z.infer<typeof runLeaderLotterySchema>;
}) {
  const { actor, input } = params;

  if (actor.role !== "LEADER") {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }

  const facultyId = actor.facultyId;
  if (!facultyId) {
    return { status: 400, body: { success: false, error: "Líder sem faculdade vinculada" } } as const;
  }

  const validIds = await getValidInternIdsForFaculty({
    facultyId,
    internIds: input.internIds,
  });

  const safeIds = input.internIds.filter((id) => validIds.has(id));
  if (safeIds.length === 0) {
    return { status: 400, body: { success: false, error: "Nenhum interno válido selecionado" } } as const;
  }

  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(input.weekStart + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + i);
    weekDates.push(date.toISOString().slice(0, 10));
  }

  const rules = await getSlotRulesForFaculty(facultyId);
  const existing = await getExistingAssignmentsForWeek({
    facultyId,
    weekStart: weekDates[0],
    weekEnd: weekDates[6],
  });

  const facultyAbbreviation = await getFacultyAbbreviation(facultyId);
  const isEbmsp = facultyAbbreviation === "EBMSP";

  const positions: Pos[] = [];

  for (const rule of rules) {
    const dayIdx = DOW_INDEX[rule.dayOfWeek];
    if (dayIdx === undefined) continue;
    const dateStr = weekDates[dayIdx];
    if (!dateStr) continue;

    const filled = existing.filter(
      (assignment) => assignment.baseId === rule.baseId && assignment.date === dateStr && assignment.period === rule.period,
    ).length;

    const openCount = rule.capacity - filled;

    if (isEbmsp && rule.period === "DAY" && rule.baseType === "CENTRAL") {
      const morningCount = Math.ceil(openCount / 2);
      const afternoonCount = openCount - morningCount;
      for (let j = 0; j < morningCount; j++) {
        positions.push({
          baseId: rule.baseId,
          baseCode: rule.baseCode,
          baseType: rule.baseType,
          date: dateStr,
          period: "DAY",
          shift: "MORNING",
        });
      }
      for (let j = 0; j < afternoonCount; j++) {
        positions.push({
          baseId: rule.baseId,
          baseCode: rule.baseCode,
          baseType: rule.baseType,
          date: dateStr,
          period: "DAY",
          shift: "AFTERNOON",
        });
      }
    } else {
      for (let j = 0; j < openCount; j++) {
        positions.push({
          baseId: rule.baseId,
          baseCode: rule.baseCode,
          baseType: rule.baseType,
          date: dateStr,
          period: rule.period as "DAY" | "NIGHT",
          shift: null,
        });
      }
    }
  }

  positions.sort((left, right) => {
    if (left.period !== right.period) return left.period === "DAY" ? -1 : 1;
    const leftIndex = BASE_PRIORITY.indexOf(left.baseCode);
    const rightIndex = BASE_PRIORITY.indexOf(right.baseCode);
    return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
  });

  const shuffled = [...safeIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const usedSlots = new Map<string, Set<string>>();
  for (const id of safeIds) usedSlots.set(id, new Set());
  for (const assignment of existing) {
    if (!usedSlots.has(assignment.internId)) continue;
    const slotKey = isEbmsp
      ? `${assignment.date}|${assignment.period}|${(assignment as { shift?: string | null }).shift ?? ""}`
      : `${assignment.date}|${assignment.period}`;
    usedSlots.get(assignment.internId)!.add(slotKey);
  }

  const cruBlocked = await getCruBlockedSlots(safeIds, weekDates[0], weekDates[6]);

  const existingShiftCount = new Map<string, number>();
  for (const id of safeIds) existingShiftCount.set(id, 0);
  for (const assignment of existing) {
    if (assignment.baseType !== "USA") continue;
    if (!existingShiftCount.has(assignment.internId)) continue;
    existingShiftCount.set(assignment.internId, (existingShiftCount.get(assignment.internId) ?? 0) + 1);
  }

  function canAssign(internId: string, pos: Pos, shiftCount: number): boolean {
    const key = isEbmsp && pos.shift ? `${pos.date}|${pos.period}|${pos.shift}` : `${pos.date}|${pos.period}`;
    if (usedSlots.get(internId)?.has(key)) return false;
    if (pos.baseType !== "CENTRAL" && pos.baseCode !== "CRL") {
      if (cruBlocked.get(internId)?.has(`${pos.date}|${pos.period}`)) return false;
    }
    if (shiftCount >= input.maxShifts) return false;
    return true;
  }

  function addCruBlocking(internId: string, pos: Pos) {
    if (pos.baseType !== "CENTRAL") return;
    if (!cruBlocked.has(internId)) cruBlocked.set(internId, new Set());
    const blocked = cruBlocked.get(internId)!;
    blocked.add(`${pos.date}|${pos.period}`);
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

  const toCreate: Array<{
    internId: string;
    facultyId: string;
    baseId: string;
    date: string;
    period: "DAY" | "NIGHT";
    shift: string | null;
    createdBy: string;
  }> = [];

  const newShiftCount = new Map<string, number>();
  for (const id of safeIds) newShiftCount.set(id, 0);

  const positionTaken = new Array(positions.length).fill(false);

  for (let round = 0; round < input.maxShifts; round++) {
    for (const internId of shuffled) {
      const totalShifts = (existingShiftCount.get(internId) ?? 0) + (newShiftCount.get(internId) ?? 0);
      if (totalShifts >= input.maxShifts) continue;

      let bestIdx = -1;
      for (let i = 0; i < positions.length; i++) {
        if (positionTaken[i]) continue;
        if (!canAssign(internId, positions[i], totalShifts)) continue;
        bestIdx = i;
        break;
      }

      if (bestIdx === -1) continue;

      const pos = positions[bestIdx];
      const key = isEbmsp && pos.shift ? `${pos.date}|${pos.period}|${pos.shift}` : `${pos.date}|${pos.period}`;

      positionTaken[bestIdx] = true;
      usedSlots.get(internId)!.add(key);
      if (pos.baseType === "USA") {
        newShiftCount.set(internId, (newShiftCount.get(internId) ?? 0) + 1);
      }
      addCruBlocking(internId, pos);

      toCreate.push({
        internId,
        facultyId,
        baseId: pos.baseId,
        date: pos.date,
        period: pos.period,
        shift: pos.shift,
        createdBy: actor.realUserId ?? actor.id,
      });
    }
  }

  await insertLotteryAssignments(toCreate);

  if (toCreate.length > 0) {
    await logAudit({
      userId: actor.realUserId ?? actor.id,
      action: "LOTTERY",
      entity: "assignment",
      entityId: toCreate[0].internId,
      payload: {
        weekStart: input.weekStart,
        maxShifts: input.maxShifts,
        selected: safeIds.length,
        created: toCreate.length,
        ...(actor.isImpersonating ? { impersonating: actor.id } : {}),
      },
    });
  }

  const internsAllocated = new Set(toCreate.map((item) => item.internId)).size;
  const remainingPositions = positionTaken.filter((taken) => !taken).length;

  return {
    status: 200,
    body: {
      success: true,
      data: {
        total: toCreate.length,
        weekStart: input.weekStart,
        maxShifts: input.maxShifts,
        internsAllocated,
        internsTotal: safeIds.length,
        remainingPositions,
      },
    },
  } as const;
}
