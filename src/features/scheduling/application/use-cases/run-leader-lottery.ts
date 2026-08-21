import { z } from "zod/v4";
import { getCruBlockedSlots } from "@/lib/slots";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  getBaseHistoryForInterns,
  getExistingAssignmentsForWeek,
  getFacultyAbbreviation,
  getSlotRulesForFaculty,
  getValidInternIdsForFaculty,
  insertLotteryAssignments,
} from "@/features/scheduling/infra/repositories/lottery-repository";
import {
  allocatePositions,
  applyMatchesToBaseTally,
  applyMatchesToPeriodTally,
  type AllocPos,
  type BaseTally,
  type PeriodTally,
} from "./allocate-positions";
import { temFeature } from "@/lib/instance";
import {
  bloqueiosCompostos,
  internosParaBloqueio,
} from "@/features/scheduling/infra/repositories/unavailability-repository";
import {
  buildUnallocatedDiagnostics,
  type UnallocatedDiagnosticItem,
  type UnallocatedReason,
} from "./lottery-diagnostics";

/**
 * Base priority for the lottery (DAY shifts fill first, then in this order).
 * Bases at the END of the list are the first to stay empty if there aren't enough interns.
 */
const BASE_PRIORITY = [
  "SM01", "PM04", "PM40", "CN10", "PR03", "CC70",
  "BR60", "CB02", "IT30", "CZ50", "BR05", "PP20",
];

/**
 * Quanto tempo para trás o sorteio olha para saber em que bases o interno já
 * esteve. Cobre com folga uma turma inteira — o suficiente para não repetir a
 * base do interno dentro do estágio dele.
 */
const HISTORICO_DE_BASES_DIAS = 120;

const DOW_INDEX: Record<string, number> = {
  MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6,
};

export const runLeaderLotterySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  internIds: z.array(z.string().uuid()).min(1),
  maxShifts: z.number().int().min(1).max(7).default(1),
  /**
   * Quantas semanas consecutivas sortear a partir de weekStart (padrão 1).
   * maxShifts continua valendo POR semana; a equidade diurno/noturno é que é
   * acompanhada ao longo de todas as semanas do lote.
   */
  numWeeks: z.number().int().min(1).max(8).default(1),
  /**
   * Faculdade alvo. O líder não manda (usa a dele); o COORDINATOR precisa
   * mandar, porque não é vinculado a nenhuma e as regras de vaga são por
   * faculdade. Ver run-admin-lottery.ts.
   */
  facultyId: z.string().uuid().optional(),
});

export type LeaderLotteryActor = {
  id: string;
  role: string;
  facultyId: string | null;
  isImpersonating: boolean;
  realUserId: string | null;
};

type SlotRuleLite = {
  baseType: string;
  period: string;
};

export function shouldIncludeRuleInLottery(rule: SlotRuleLite, isEbmsp: boolean) {
  // Lottery sorteia apenas USA (intervenção).
  // Exceção: EBMSP usa CENTRAL no período DAY por split MORNING/AFTERNOON.
  const isCentralDay = rule.period === "DAY" && rule.baseType === "CENTRAL";
  return rule.baseType === "USA" || (isEbmsp && isCentralDay);
}

type SlotRuleRow = {
  baseId: string;
  baseCode: string;
  baseType: string;
  dayOfWeek: string;
  period: string;
  capacity: number;
};

type WeekExistingRow = {
  baseId: string;
  baseType: string;
  date: string;
  period: string;
  shift: string | null;
};

function weekDatesFrom(weekStart: string): string[] {
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    dates.push(addDays(weekStart, i));
  }
  return dates;
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Monta as vagas sorteáveis de UMA semana: capacidade menos o que já está
 * preenchido, filtradas para USA (e CENTRAL/DAY no EBMSP com split manhã/tarde),
 * ordenadas DAY-first e então por BASE_PRIORITY.
 */
function buildWeekPositions(params: {
  rules: SlotRuleRow[];
  weekExisting: WeekExistingRow[];
  weekDates: string[];
  isEbmsp: boolean;
}): AllocPos[] {
  const { rules, weekExisting, weekDates, isEbmsp } = params;
  const positions: AllocPos[] = [];

  for (const rule of rules) {
    const dayIdx = DOW_INDEX[rule.dayOfWeek];
    if (dayIdx === undefined) continue;
    const dateStr = weekDates[dayIdx];
    if (!dateStr) continue;

    if (!shouldIncludeRuleInLottery(rule, isEbmsp)) continue;

    const filled = weekExisting.filter(
      (assignment) => assignment.baseId === rule.baseId && assignment.date === dateStr && assignment.period === rule.period,
    ).length;

    const openCount = rule.capacity - filled;

    if (isEbmsp && rule.period === "DAY" && rule.baseType === "CENTRAL") {
      const morningCount = Math.ceil(openCount / 2);
      const afternoonCount = openCount - morningCount;
      for (let j = 0; j < morningCount; j++) {
        positions.push({ baseId: rule.baseId, baseCode: rule.baseCode, baseType: rule.baseType, date: dateStr, period: "DAY", shift: "MORNING" });
      }
      for (let j = 0; j < afternoonCount; j++) {
        positions.push({ baseId: rule.baseId, baseCode: rule.baseCode, baseType: rule.baseType, date: dateStr, period: "DAY", shift: "AFTERNOON" });
      }
    } else {
      for (let j = 0; j < openCount; j++) {
        positions.push({ baseId: rule.baseId, baseCode: rule.baseCode, baseType: rule.baseType, date: dateStr, period: rule.period as "DAY" | "NIGHT", shift: null });
      }
    }
  }

  positions.sort((left, right) => {
    if (left.period !== right.period) return left.period === "DAY" ? -1 : 1;
    const leftIndex = BASE_PRIORITY.indexOf(left.baseCode);
    const rightIndex = BASE_PRIORITY.indexOf(right.baseCode);
    return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
  });

  return positions;
}

export async function executeRunLeaderLottery(params: {
  actor: LeaderLotteryActor;
  input: z.infer<typeof runLeaderLotterySchema>;
}) {
  const { actor, input } = params;

  const ehCoordenador = actor.role === "COORDINATOR";
  if (actor.role !== "LEADER" && !ehCoordenador) {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }

  // O líder sorteia sempre a própria faculdade, independente do que mandar no
  // corpo — aceitar facultyId dele seria deixar sortear a escala de outra.
  const facultyId = ehCoordenador ? input.facultyId : actor.facultyId;
  if (!facultyId) {
    return {
      status: 400,
      body: {
        success: false,
        error: ehCoordenador ? "Selecione a faculdade" : "Líder sem faculdade vinculada",
      },
    } as const;
  }

  const validIds = await getValidInternIdsForFaculty({
    facultyId,
    internIds: input.internIds,
  });

  const safeIds = input.internIds.filter((id) => validIds.has(id));
  if (safeIds.length === 0) {
    return { status: 400, body: { success: false, error: "Nenhum interno válido selecionado" } } as const;
  }

  const numWeeks = input.numWeeks;

  // Janelas de cada semana do lote (disjuntas, +7 dias uma da outra).
  const weekWindows: string[][] = [];
  for (let w = 0; w < numWeeks; w++) {
    weekWindows.push(weekDatesFrom(addDays(input.weekStart, 7 * w)));
  }
  const windowStart = weekWindows[0][0];
  const windowEnd = weekWindows[numWeeks - 1][6];

  const rules = await getSlotRulesForFaculty(facultyId);
  // Existentes da janela INTEIRA de uma vez: servem para descontar vaga já
  // preenchida, contar plantão USA por semana e semear a equidade diurno/noturno.
  const existingAll = await getExistingAssignmentsForWeek({
    facultyId,
    weekStart: windowStart,
    weekEnd: windowEnd,
  });

  const facultyAbbreviation = await getFacultyAbbreviation(facultyId);
  const isEbmsp = facultyAbbreviation === "EBMSP";
  const usaUnavailability = temFeature("internUnavailability");

  // Slots já ocupados na janela. As semanas são disjuntas em data, então não há
  // colisão cruzada — acumular tudo é só segurança.
  const usedSlots = new Map<string, Set<string>>();
  for (const id of safeIds) usedSlots.set(id, new Set());
  for (const assignment of existingAll) {
    if (!usedSlots.has(assignment.internId)) continue;
    const slotKey = isEbmsp
      ? `${assignment.date}|${assignment.period}|${(assignment as { shift?: string | null }).shift ?? ""}`
      : `${assignment.date}|${assignment.period}`;
    usedSlots.get(assignment.internId)!.add(slotKey);
  }

  // Equidade diurno/noturno (SOFT): semeia com os plantões existentes na janela
  // e vai acumulando entre as semanas do lote. É só reordenação de preferência —
  // nunca impede alocação (ver allocate-positions.ts).
  const periodTally = new Map<string, PeriodTally>();
  for (const id of safeIds) periodTally.set(id, { day: 0, night: 0 });
  for (const assignment of existingAll) {
    const tally = periodTally.get(assignment.internId);
    if (!tally) continue;
    if (assignment.period === "DAY") tally.day += 1;
    else tally.night += 1;
  }

  // Equidade de base (SOFT): quantas vezes cada interno já caiu em cada base no
  // histórico recente. Também só reordena preferência — ver allocate-positions.
  const baseHistory = await getBaseHistoryForInterns({
    internIds: safeIds,
    dateFrom: addDays(windowStart, -HISTORICO_DE_BASES_DIAS),
    dateTo: windowEnd,
  });
  const baseTally = new Map<string, BaseTally>();
  for (const id of safeIds) baseTally.set(id, new Map());
  for (const row of baseHistory) {
    const porBase = baseTally.get(row.internId);
    if (!porBase) continue;
    porBase.set(row.baseCode, (porBase.get(row.baseCode) ?? 0) + 1);
  }

  type LotteryInsert = {
    internId: string;
    facultyId: string;
    baseId: string;
    date: string;
    period: "DAY" | "NIGHT";
    shift: string | null;
    createdBy: string;
  };

  const allToCreate: LotteryInsert[] = [];
  const weekResults: Array<{
    weekStart: string;
    total: number;
    internsAllocated: number;
    remainingPositions: number;
  }> = [];
  const aggregatedSummary: Record<UnallocatedReason, number> = {
    NO_REMAINING_POSITIONS: 0,
    MAX_SHIFTS_REACHED: 0,
    CRU_12H_CONFLICT: 0,
    SLOT_ALREADY_OCCUPIED: 0,
    CONSTRAINT_MIXED: 0,
  };
  const aggregatedUnallocatedItems: UnallocatedDiagnosticItem[] = [];

  for (let w = 0; w < numWeeks; w++) {
    const weekDates = weekWindows[w];
    const weekExisting = existingAll.filter(
      (assignment) => assignment.date >= weekDates[0] && assignment.date <= weekDates[6],
    );

    const positions = buildWeekPositions({ rules, weekExisting, weekDates, isEbmsp });

    const cruBlocked = await getCruBlockedSlots(safeIds, weekDates[0], weekDates[6]);

    // Indisponibilidade do interno (instância Vitalmed): o que ele declarou, o
    // dia fixo de aula da faculdade e os plantões dele no SAMU. Onde a feature
    // não existe, o mapa volta vazio e nada muda no sorteio.
    const unavailable = new Map<string, Set<string>>();
    if (usaUnavailability) {
      const compostos = await bloqueiosCompostos({
        internos: await internosParaBloqueio({
          internIds: safeIds,
          facultyAbbr: facultyAbbreviation,
        }),
        dateFrom: weekDates[0],
        dateTo: weekDates[6],
      });

      // O sorteio decide em massa e sem ninguém olhando. Se a escala do SAMU não
      // pôde ser lida, seguir significa escalar gente que está de plantão lá —
      // melhor recusar o lote inteiro (nada foi gravado ainda) do que criar
      // conflito calado.
      if (compostos.samu === "falhou") {
        return {
          success: false as const,
          error:
            "Não consegui consultar a escala do SAMU agora, e sortear sem ela pode escalar " +
            "interno que já está de plantão lá. Tente de novo em alguns instantes.",
        };
      }

      for (const [internId, porSlot] of compostos.mapa) {
        unavailable.set(internId, new Set(porSlot.keys()));
      }
    }

    // Limite de plantões USA vale POR semana.
    const existingShiftCount = new Map<string, number>();
    for (const id of safeIds) existingShiftCount.set(id, 0);
    for (const assignment of weekExisting) {
      if (assignment.baseType !== "USA") continue;
      if (!existingShiftCount.has(assignment.internId)) continue;
      existingShiftCount.set(assignment.internId, (existingShiftCount.get(assignment.internId) ?? 0) + 1);
    }

    const { matches, unallocatedInterns, remainingPositions: remainingPos, remainingPositionsList } = allocatePositions({
      positions,
      internIds: shuffle(safeIds),
      maxShifts: input.maxShifts,
      isEbmsp,
      existingUsaShiftCount: existingShiftCount,
      usedSlots,
      cruBlocked,
      unavailable,
      periodTally,
      baseTally,
    });

    // Carrega a equidade para a próxima semana e registra os slots ocupados.
    applyMatchesToPeriodTally(periodTally, matches);
    applyMatchesToBaseTally(baseTally, matches);
    for (const { internId, position: pos } of matches) {
      const slotKey = isEbmsp
        ? `${pos.date}|${pos.period}|${pos.shift ?? ""}`
        : `${pos.date}|${pos.period}`;
      if (!usedSlots.has(internId)) usedSlots.set(internId, new Set());
      usedSlots.get(internId)!.add(slotKey);

      allToCreate.push({
        internId,
        facultyId,
        baseId: pos.baseId,
        date: pos.date,
        period: pos.period,
        shift: pos.shift,
        createdBy: actor.realUserId ?? actor.id,
      });
    }

    const weekDiagnostics = buildUnallocatedDiagnostics({
      unallocatedInternIds: unallocatedInterns,
      remainingPositions: remainingPositionsList,
      maxShifts: input.maxShifts,
      isEbmsp,
      existingUsaShiftCount: existingShiftCount,
      usedSlots,
      cruBlocked,
    });

    weekResults.push({
      weekStart: weekDates[0],
      total: matches.length,
      internsAllocated: new Set(matches.map((match) => match.internId)).size,
      remainingPositions: remainingPos,
    });
    for (const reason of Object.keys(aggregatedSummary) as UnallocatedReason[]) {
      aggregatedSummary[reason] += weekDiagnostics.summary[reason];
    }
    aggregatedUnallocatedItems.push(...weekDiagnostics.items);
  }

  await insertLotteryAssignments(allToCreate);

  if (allToCreate.length > 0) {
    await logAudit({
      userId: actor.realUserId ?? actor.id,
      action: "LOTTERY",
      entity: "assignment",
      entityId: allToCreate[0].internId,
      payload: {
        weekStart: input.weekStart,
        numWeeks,
        maxShifts: input.maxShifts,
        selected: safeIds.length,
        created: allToCreate.length,
        ...(actor.isImpersonating ? { impersonating: actor.id } : {}),
      },
    });
  }

  const internsAllocated = new Set(allToCreate.map((item) => item.internId)).size;
  const remainingPositions = weekResults.reduce((sum, week) => sum + week.remainingPositions, 0);

  return {
    status: 200,
    body: {
      success: true,
      data: {
        total: allToCreate.length,
        weekStart: input.weekStart,
        numWeeks,
        maxShifts: input.maxShifts,
        internsAllocated,
        internsTotal: safeIds.length,
        remainingPositions,
        unallocatedInterns: aggregatedUnallocatedItems,
        unallocatedSummary: aggregatedSummary,
        weeks: weekResults,
      },
    },
  } as const;
}
