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
import { randomInt } from "node:crypto";
import { type AllocPos } from "./allocate-positions";
import { sortearHorizonte, type HistoricoDoInterno } from "./lottery-horizon";
import { temFeature } from "@/lib/instance";
import { listReleasedOffers } from "@/features/extra-offers/infra/repositories/extra-offer-repository";
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

/** Nota da base para a justiça do sorteio: 1 = topo da BASE_PRIORITY, perto de 0 = fim. */
export function qualidadeDaBase(baseCode: string): number | null {
  const idx = BASE_PRIORITY.indexOf(baseCode);
  return idx === -1 ? null : (BASE_PRIORITY.length - idx) / BASE_PRIORITY.length;
}

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

/**
 * Monta as vagas sorteáveis de UMA semana: capacidade menos o que já está
 * preenchido, filtradas para USA (e CENTRAL/DAY no EBMSP com split manhã/tarde),
 * ordenadas DAY-first e então por BASE_PRIORITY.
 */
export function buildWeekPositions(params: {
  rules: SlotRuleRow[];
  weekExisting: WeekExistingRow[];
  weekDates: string[];
  isEbmsp: boolean;
  /** Vagas liberadas pela faculdade, por `${baseId}|${date}|${period}` (ver release-slots.ts). */
  released?: Map<string, number>;
}): AllocPos[] {
  const { rules, weekExisting, weekDates, isEbmsp, released } = params;
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

    const releasedCount = released?.get(`${rule.baseId}|${dateStr}|${rule.period}`) ?? 0;
    const openCount = rule.capacity - filled - releasedCount;

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
  // Um dia de folga em cada ponta: o plantão de domingo à noite da véspera
  // também conta para o descanso de 12h da segunda de manhã.
  const existingAll = await getExistingAssignmentsForWeek({
    facultyId,
    weekStart: addDays(windowStart, -1),
    weekEnd: addDays(windowEnd, 1),
  });

  // Vagas que a faculdade liberou na janela ficam fora do sorteio — pegas ou
  // não por outra faculdade, ela abriu mão delas.
  const released = new Map<string, number>();
  for (const offer of await listReleasedOffers({ facultyId, from: windowStart, to: windowEnd })) {
    const key = `${offer.baseId}|${offer.date}|${offer.period}`;
    released.set(key, (released.get(key) ?? 0) + 1);
  }

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

  // Histórico de plantão SORTEÁVEL de cada interno (CRU/CRL fixo fica de fora:
  // é igual para a turma toda e só distorceria a cota de noturno).
  const historico = new Map<string, HistoricoDoInterno>();
  for (const id of safeIds) historico.set(id, { plantoes: 0, noturnos: 0, bases: new Map() });
  for (const row of await getBaseHistoryForInterns({
    internIds: safeIds,
    dateFrom: addDays(windowStart, -HISTORICO_DE_BASES_DIAS),
    dateTo: windowEnd,
  })) {
    if (!shouldIncludeRuleInLottery(row, isEbmsp)) continue;
    const h = historico.get(row.internId);
    if (!h) continue;
    h.plantoes += 1;
    if (row.period === "NIGHT") h.noturnos += 1;
    h.bases.set(row.baseCode, (h.bases.get(row.baseCode) ?? 0) + 1);
  }

  const cruBlocked = await getCruBlockedSlots(safeIds, windowStart, windowEnd);

  // Indisponibilidade do interno (instância Vitalmed): o que ele declarou, o
  // dia fixo de aula da faculdade e os plantões dele no SAMU. Onde a feature
  // não existe, o mapa fica vazio e nada muda no sorteio.
  const unavailable = new Map<string, Set<string>>();
  if (usaUnavailability) {
    const compostos = await bloqueiosCompostos({
      internos: await internosParaBloqueio({
        internIds: safeIds,
        facultyAbbr: facultyAbbreviation,
      }),
      dateFrom: windowStart,
      dateTo: windowEnd,
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

  // Vagas e plantões USA já existentes, semana a semana (o teto é POR semana).
  const positionsByWeek: AllocPos[][] = [];
  const existingUsaShiftCountByWeek: Array<Map<string, number>> = [];
  for (const weekDates of weekWindows) {
    const weekExisting = existingAll.filter(
      (assignment) => assignment.date >= weekDates[0] && assignment.date <= weekDates[6],
    );
    positionsByWeek.push(buildWeekPositions({ rules, weekExisting, weekDates, isEbmsp, released }));

    const count = new Map<string, number>(safeIds.map((id) => [id, 0]));
    for (const assignment of weekExisting) {
      if (assignment.baseType !== "USA" || !count.has(assignment.internId)) continue;
      count.set(assignment.internId, (count.get(assignment.internId) ?? 0) + 1);
    }
    existingUsaShiftCountByWeek.push(count);
  }

  // O lote inteiro de uma vez — ver lottery-horizon.ts.
  const sorteio = sortearHorizonte({
    positionsByWeek,
    internIds: safeIds,
    maxShifts: input.maxShifts,
    isEbmsp,
    existingUsaShiftCountByWeek,
    usedSlots,
    cruBlocked,
    unavailable,
    historico,
    qualidade: qualidadeDaBase,
    seed: randomInt(2 ** 31),
  });

  type LotteryInsert = {
    internId: string;
    facultyId: string;
    baseId: string;
    date: string;
    period: "DAY" | "NIGHT";
    shift: string | null;
    createdBy: string;
  };

  const allToCreate: LotteryInsert[] = sorteio.matches.map(({ internId, position: pos }) => ({
    internId,
    facultyId,
    baseId: pos.baseId,
    date: pos.date,
    period: pos.period,
    shift: pos.shift,
    createdBy: actor.realUserId ?? actor.id,
  }));
  for (const { internId, position: pos } of sorteio.matches) {
    const slotKey = isEbmsp ? `${pos.date}|${pos.period}|${pos.shift ?? ""}` : `${pos.date}|${pos.period}`;
    usedSlots.get(internId)?.add(slotKey);
  }

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
    const daSemana = sorteio.matches.filter((match) => match.week === w);
    const alocados = new Set(daSemana.map((match) => match.internId));

    const weekDiagnostics = buildUnallocatedDiagnostics({
      unallocatedInternIds: safeIds.filter((id) => !alocados.has(id)),
      remainingPositions: sorteio.emptyByWeek[w],
      maxShifts: input.maxShifts,
      isEbmsp,
      existingUsaShiftCount: existingUsaShiftCountByWeek[w],
      usedSlots,
      cruBlocked,
    });

    weekResults.push({
      weekStart: weekWindows[w][0],
      total: daSemana.length,
      internsAllocated: alocados.size,
      remainingPositions: sorteio.emptyByWeek[w].length,
    });
    for (const reason of Object.keys(aggregatedSummary) as UnallocatedReason[]) {
      aggregatedSummary[reason] += weekDiagnostics.summary[reason];
    }
    aggregatedUnallocatedItems.push(...weekDiagnostics.items);
  }

  // O resumo vai para a tela e para o audit; o detalhe por interno não.
  const justica = {
    noturnosIdeal: sorteio.justica.noturnosIdeal,
    noturnos: sorteio.justica.noturnos,
    plantoes: sorteio.justica.plantoes,
    qualidadeMedia: sorteio.justica.qualidadeMedia,
    basesRepetidas: sorteio.justica.basesRepetidas,
  };

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
        seed: sorteio.seed,
        justica,
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
        justica,
      },
    },
  } as const;
}
