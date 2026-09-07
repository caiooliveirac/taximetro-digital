/**
 * Vaga liberada pela faculdade.
 *
 * O líder avisa que numa data/turno a faculdade não vai usar as vagas da grade
 * fixa (compromisso, prova, evento) — ou abre mão de UMA vaga específica pela
 * grade. Cada vaga liberada vira uma oferta no board de Extras, marcada com
 * `releasedFacultyId`, para as outras faculdades pegarem. Enquanto a oferta
 * estiver viva (pega ou não), o sorteio e a grade da faculdade descontam a vaga.
 *
 * Não existe tabela própria de propósito: a oferta é o registro. Cancelar a
 * oferta desfaz a liberação; oferta já pega não se desfaz por aqui.
 */

import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import { localDateStr } from "@/lib/utils";
import {
  cancelReleasedOffers,
  insertExtraOffers,
  listFreeOffers,
  listReleasedOffers,
} from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import {
  getExistingAssignmentsForWeek,
  getFacultyAbbreviation,
  getRemovableAssignmentsForSlot,
  getSlotRulesForFaculty,
} from "@/features/scheduling/infra/repositories/lottery-repository";
import { updateAssignmentStatus } from "@/features/scheduling/infra/repositories/assignment-repository";
import { shouldIncludeRuleInLottery } from "./run-leader-lottery";
import type { SchedulingActor } from "./cru-fixed-shared";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const releaseSlotsSchema = z.object({
  date: DATE,
  period: z.enum(["DAY", "NIGHT"]),
  /** Com base: só ela. Sem base: as vagas do dia/turno conforme `scope`. */
  baseId: z.string().uuid().optional(),
  /** USA = só intervenção (o que o sorteio usa). ALL = intervenção e regulação (CRU/CRL) também. */
  scope: z.enum(["USA", "ALL"]).default("USA"),
  /** Só calcula: quantas vagas abrem e quais internos sairiam da escala. Não grava nada. */
  preview: z.boolean().default(false),
  facultyId: z.string().uuid().optional(),
});

export const undoReleaseSchema = z.object({
  id: z.string().uuid().optional(),
  date: DATE.optional(),
  period: z.enum(["DAY", "NIGHT"]).optional(),
  baseId: z.string().uuid().optional(),
  facultyId: z.string().uuid().optional(),
}).refine((v) => v.id || (v.date && v.period), { message: "Informe id ou data e turno" });

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
function dayOfWeekKey(date: string) {
  return DOW[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/** Mesma regra do sorteio: o líder só mexe na própria faculdade. */
function faculdadeDoAtor(actor: SchedulingActor, input: { facultyId?: string }) {
  if (actor.role === "LEADER") return actor.facultyId;
  if (actor.role === "COORDINATOR") return input.facultyId ?? actor.facultyId;
  return null;
}

export async function executeListReleased(params: {
  actor: SchedulingActor;
  input: { from: string; to: string; facultyId?: string };
}) {
  const facultyId = faculdadeDoAtor(params.actor, params.input);
  if (!facultyId) return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  const rows = await listReleasedOffers({ facultyId, from: params.input.from, to: params.input.to });
  return { status: 200, body: { success: true, data: rows } } as const;
}

/** Vagas que as outras faculdades liberaram e esta pode usar. */
export async function executeListFreeSlots(params: {
  actor: SchedulingActor;
  input: { from: string; to: string; facultyId?: string };
}) {
  const facultyId = faculdadeDoAtor(params.actor, params.input);
  if (!facultyId) return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  const rows = await listFreeOffers({ excludeFacultyId: facultyId, from: params.input.from, to: params.input.to });
  return { status: 200, body: { success: true, data: rows } } as const;
}

export async function executeReleaseSlots(params: {
  actor: SchedulingActor;
  input: z.infer<typeof releaseSlotsSchema>;
}) {
  const { actor, input } = params;
  const facultyId = faculdadeDoAtor(actor, input);
  if (!facultyId) return { status: 403, body: { success: false, error: "Sem permissão" } } as const;

  if (input.date < localDateStr()) {
    return { status: 400, body: { success: false, error: "Não dá para liberar vaga de data passada" } } as const;
  }

  const abbr = await getFacultyAbbreviation(facultyId);
  const isEbmsp = abbr === "EBMSP";
  const dow = dayOfWeekKey(input.date);

  const rules = (await getSlotRulesForFaculty(facultyId)).filter((rule) =>
    rule.dayOfWeek === dow
    && rule.period === input.period
    && (input.baseId
      ? rule.baseId === input.baseId
      : input.scope === "ALL" || shouldIncludeRuleInLottery(rule, isEbmsp)),
  );

  // Liberar o dia/turno inteiro tira da escala quem já estava marcado e ainda
  // não começou o plantão: a faculdade não vai usar a vaga, então o interno sai
  // e volta a contar como abaixo da meta (dashboard do líder e Ver interno).
  // Liberar UMA vaga pela grade (baseId) é só a vaga aberta — ninguém sai.
  const removiveis = input.baseId
    ? []
    : await getRemovableAssignmentsForSlot({
      facultyId, date: input.date, period: input.period, baseIds: rules.map((r) => r.baseId),
    });
  const idsRemovidos = new Set(removiveis.map((a) => a.id));

  const [existing, released] = await Promise.all([
    getExistingAssignmentsForWeek({ facultyId, weekStart: input.date, weekEnd: input.date }),
    listReleasedOffers({ facultyId, from: input.date, to: input.date }),
  ]);

  const publishedBy = actor.realUserId ?? actor.id;
  const toCreate = rules.flatMap((rule) => {
    const filled = existing.filter((a) =>
      a.baseId === rule.baseId && a.period === rule.period && !idsRemovidos.has((a as { id?: string }).id ?? ""),
    ).length;
    const already = released.filter((r) => r.baseId === rule.baseId && r.period === rule.period).length;
    const open = Math.max(rule.capacity - filled - already, 0);
    return Array.from({ length: open }, () => ({
      baseId: rule.baseId,
      date: input.date,
      period: input.period,
      notes: `Vaga liberada pela ${abbr ?? "faculdade"}`,
      publishedBy,
      releasedFacultyId: facultyId,
    }));
  });

  const internos = removiveis.map((a) => ({ assignmentId: a.id, internId: a.internId, internName: a.internName, baseCode: a.baseCode }));

  if (input.preview) {
    return { status: 200, body: { success: true, data: { open: toCreate.length, interns: internos } } } as const;
  }

  const quando = `${input.date.slice(8, 10)}/${input.date.slice(5, 7)} ${input.period === "DAY" ? "diurno" : "noturno"}`;
  for (const a of removiveis) {
    await updateAssignmentStatus({
      id: a.id,
      status: "CANCELLED",
      notes: `Removido da escala: a ${abbr ?? "faculdade"} liberou a vaga de ${quando} para outras faculdades`,
    });
  }

  const created = await insertExtraOffers(toCreate);

  if (created.length > 0 || removiveis.length > 0) {
    await logAudit({
      userId: publishedBy,
      action: "SLOTS_RELEASED",
      entity: "extra_shift_offers",
      entityId: created[0].id,
      // Campos legíveis de propósito: a auditoria mostra isto para gente.
      payload: {
        facultyId, facultyAbbr: abbr, date: input.date, period: input.period,
        scope: input.scope, created: created.length,
        bases: [...new Set(rules.filter((r) => toCreate.some((c) => c.baseId === r.baseId)).map((r) => r.baseCode))],
        removedInterns: internos.map((i) => `${i.internName} (${i.baseCode})`),
        ...(actor.isImpersonating ? { impersonating: actor.id } : {}),
      },
    });
  }

  return { status: 200, body: { success: true, data: { created: created.length, interns: internos } } } as const;
}

export async function executeUndoRelease(params: {
  actor: SchedulingActor;
  input: z.infer<typeof undoReleaseSchema>;
}) {
  const { actor, input } = params;
  const facultyId = faculdadeDoAtor(actor, input);
  if (!facultyId) return { status: 403, body: { success: false, error: "Sem permissão" } } as const;

  const cancelledBy = actor.realUserId ?? actor.id;
  const abbr = await getFacultyAbbreviation(facultyId);
  const cancelled = await cancelReleasedOffers({
    facultyId,
    cancelledBy,
    ...(input.id ? { ids: [input.id] } : { date: input.date, period: input.period, baseId: input.baseId }),
  });

  if (cancelled > 0) {
    await logAudit({
      userId: cancelledBy,
      action: "SLOTS_RELEASE_UNDONE",
      entity: "extra_shift_offers",
      entityId: input.id ?? facultyId,
      payload: { facultyId, facultyAbbr: abbr, date: input.date ?? null, period: input.period ?? null, cancelled },
    });
  }

  return { status: 200, body: { success: true, data: { cancelled } } } as const;
}
