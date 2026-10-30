/**
 * Agenda acadêmica da turma — listar, lançar (com pré-visualização) e apagar.
 * Regra em academic-commitment-policy.ts.
 *
 * Lançar faz, por turno bloqueado:
 * 1. tira da escala os internos do compromisso (plantão da grade não iniciado);
 * 2. turma inteira sem outra turma no dia: abre as vagas USA da grade como
 *    vaga liberada, marcadas com o compromisso — igual ao "Liberar vagas",
 *    mas só os internos desta turma saem.
 * O bloqueio dos internos nos outros caminhos (sorteio, CRU fixo, alocação,
 * vaga livre, extra) lê a tabela direto (academicBlocks).
 */

import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import { localDateStr, sorteiaCruDiurna } from "@/lib/utils";
import { insertExtraOffers, listReleasedOffers } from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import {
  getExistingAssignmentsForWeek,
  getFacultyAbbreviation,
  getSlotRulesForFaculty,
} from "@/features/scheduling/infra/repositories/lottery-repository";
import { updateAssignmentStatus } from "@/features/scheduling/infra/repositories/assignment-repository";
import {
  cancelCommitment,
  getCohort,
  getCommitment,
  getRemovableForInterns,
  insertCommitment,
  listCohortInterns,
  listCommitments,
  listOpenCohorts,
  listOtherCohorts,
} from "@/features/scheduling/infra/repositories/academic-commitment-repository";
import {
  cedeVagasDaGrade,
  motivoParaRecusar,
  ROTULO_TIPO,
  turnosDoCompromisso,
} from "@/features/scheduling/domain/policies/academic-commitment-policy";
import { shouldIncludeRuleInLottery } from "./run-leader-lottery";
import type { SchedulingActor } from "./cru-fixed-shared";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createCommitmentSchema = z.object({
  cohortId: z.string().uuid(),
  kind: z.enum(["PROVA", "ATIVIDADE", "AULA"]),
  title: z.string().trim().min(2).max(120),
  date: DATE,
  blocksDay: z.boolean(),
  blocksNight: z.boolean(),
  blocksEveNight: z.boolean().default(false),
  /** null ou ausente = turma inteira */
  internIds: z.array(z.string().uuid()).min(1).nullable().optional(),
  preview: z.boolean().default(false),
  facultyId: z.string().uuid().optional(),
});

/** Líder: a faculdade dele (e a turma dele, se tiver). Coordenador: a da tela. */
type Ator = SchedulingActor & { cohortId?: string | null };

function faculdadeDoAtor(actor: Ator, input: { facultyId?: string }) {
  if (actor.role === "LEADER") return actor.facultyId;
  if (actor.role === "COORDINATOR") return input.facultyId ?? actor.facultyId;
  return null;
}

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const diaDaSemana = (date: string) => DOW[new Date(`${date}T12:00:00Z`).getUTCDay()];

export async function executeListCommitments(params: { actor: Ator; input: { facultyId?: string } }) {
  const facultyId = faculdadeDoAtor(params.actor, params.input);
  if (!facultyId) return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  const hoje = localDateStr();
  const turmaDoLider = params.actor.role === "LEADER" ? params.actor.cohortId ?? null : null;

  const turmas = (await listOpenCohorts(facultyId, hoje)).filter((t) => !turmaDoLider || t.id === turmaDoLider);
  const internosPorTurma = await Promise.all(turmas.map((t) => listCohortInterns(t.id)));
  // Compromisso de amanhã bloqueia a noite de hoje: lista a partir de hoje.
  const compromissos = await listCommitments({ facultyId, from: hoje, cohortId: turmaDoLider });

  return {
    status: 200,
    body: {
      success: true,
      data: {
        turmas: turmas.map((t, i) => ({ ...t, interns: internosPorTurma[i] })),
        compromissos,
      },
    },
  } as const;
}

export async function executeCreateCommitment(params: {
  actor: Ator;
  input: z.infer<typeof createCommitmentSchema>;
}) {
  const { actor, input } = params;
  const facultyId = faculdadeDoAtor(actor, input);
  if (!facultyId) return { status: 403, body: { success: false, error: "Sem permissão" } } as const;

  const turma = await getCohort(input.cohortId);
  if (!turma || turma.facultyId !== facultyId) {
    return { status: 404, body: { success: false, error: "Turma não encontrada nesta faculdade" } } as const;
  }
  if (actor.role === "LEADER" && actor.cohortId && actor.cohortId !== turma.id) {
    return { status: 403, body: { success: false, error: "Você só lança compromisso da sua turma" } } as const;
  }

  const compromisso = {
    date: input.date,
    blocksDay: input.blocksDay,
    blocksNight: input.blocksNight,
    // Véspera só faz sentido para compromisso que começa de manhã.
    blocksEveNight: input.blocksDay && input.blocksEveNight,
  };
  const recusa = motivoParaRecusar({ compromisso, turma, hoje: localDateStr() });
  if (recusa) return { status: 400, body: { success: false, error: recusa } } as const;

  const daTurma = await listCohortInterns(turma.id);
  const idsDaTurma = new Set(daTurma.map((i) => i.id));
  const internIds = input.internIds ?? null;
  if (internIds?.some((id) => !idsDaTurma.has(id))) {
    return { status: 400, body: { success: false, error: "Há interno que não é desta turma" } } as const;
  }
  const alvo = internIds ?? [...idsDaTurma];
  const turmaInteira = internIds === null;

  const abbr = await getFacultyAbbreviation(facultyId);
  const sorteiaCru = sorteiaCruDiurna(abbr);
  const [regras, outrasTurmas] = await Promise.all([getSlotRulesForFaculty(facultyId), listOtherCohorts(facultyId, turma.id)]);

  // Plano por turno: quem sai e quantas vagas abrem.
  const turnos = turnosDoCompromisso(compromisso);
  const plano = await Promise.all(turnos.map(async (t) => {
    const removiveis = await getRemovableForInterns({ internIds: alvo, date: t.date, period: t.period });
    const daGrade = removiveis.filter((a) => !a.isExtraShift);
    // Extra pego numa vaga de outra faculdade: o líder resolve à mão.
    const extras = removiveis.filter((a) => a.isExtraShift);

    let vagas: Array<{ baseId: string }> = [];
    if (cedeVagasDaGrade({ turmaInteira, date: t.date, outrasTurmas })) {
      const sai = new Set(daGrade.map((a) => a.id));
      const [existentes, liberadas] = await Promise.all([
        getExistingAssignmentsForWeek({ facultyId, weekStart: t.date, weekEnd: t.date }),
        listReleasedOffers({ facultyId, from: t.date, to: t.date }),
      ]);
      vagas = regras
        .filter((r) => r.dayOfWeek === diaDaSemana(t.date) && r.period === t.period && shouldIncludeRuleInLottery(r, sorteiaCru))
        .flatMap((r) => {
          const ocupadas = existentes.filter((a) => a.baseId === r.baseId && a.period === t.period && !sai.has(a.id)).length;
          const jaCedidas = liberadas.filter((o) => o.baseId === r.baseId && o.period === t.period).length;
          return Array.from({ length: Math.max(r.capacity - ocupadas - jaCedidas, 0) }, () => ({ baseId: r.baseId }));
        });
    }
    return { turno: t, daGrade, extras, vagas };
  }));

  const resumo = plano.map((p) => ({
    date: p.turno.date,
    period: p.turno.period,
    open: p.vagas.length,
    interns: p.daGrade.map((a) => ({ internName: a.internName, baseCode: a.baseCode })),
    extras: p.extras.map((a) => ({ internName: a.internName, baseCode: a.baseCode })),
  }));

  if (input.preview) {
    return { status: 200, body: { success: true, data: { turnos: resumo, blocked: alvo.length, turmaInteira } } } as const;
  }

  const autor = actor.realUserId ?? actor.id;
  const novo = await insertCommitment({
    cohortId: turma.id,
    facultyId,
    kind: input.kind,
    title: input.title,
    ...compromisso,
    internIds,
    createdBy: autor,
  });

  // "Prova de Clínica" já diz o tipo; "Clínica" ganha o prefixo.
  const rotulo = input.title.toLowerCase().startsWith(ROTULO_TIPO[input.kind].toLowerCase())
    ? input.title
    : `${ROTULO_TIPO[input.kind]}: ${input.title}`;
  for (const p of plano) {
    const quando = `${p.turno.date.slice(8, 10)}/${p.turno.date.slice(5, 7)} ${p.turno.period === "DAY" ? "diurno" : "noturno"}`;
    for (const a of p.daGrade) {
      await updateAssignmentStatus({
        id: a.id,
        status: "CANCELLED",
        notes: `Removido da escala: ${rotulo} (agenda da turma) no ${quando}`,
      });
    }
    await insertExtraOffers(p.vagas.map((v) => ({
      baseId: v.baseId,
      date: p.turno.date,
      period: p.turno.period,
      notes: `${rotulo} · ${abbr ?? "faculdade"}`,
      publishedBy: autor,
      releasedFacultyId: facultyId,
      commitmentId: novo.id,
    })));
  }

  await logAudit({
    userId: autor,
    action: "COMMITMENT_CREATED",
    entity: "cohort_commitments",
    entityId: novo.id,
    payload: {
      facultyId, facultyAbbr: abbr, cohortId: turma.id, kind: input.kind, title: input.title,
      turnos: resumo.map((r) => `${r.date} ${r.period}`),
      internos: turmaInteira ? "turma inteira" : alvo.length,
      vagasCedidas: resumo.reduce((n, r) => n + r.open, 0),
      removedInterns: resumo.flatMap((r) => r.interns.map((i) => `${i.internName} (${i.baseCode} ${r.date})`)),
      ...(actor.isImpersonating ? { impersonating: actor.id } : {}),
    },
  });

  return { status: 200, body: { success: true, data: { id: novo.id, turnos: resumo } } } as const;
}

export async function executeCancelCommitment(params: { actor: Ator; input: { id: string; facultyId?: string } }) {
  const facultyId = faculdadeDoAtor(params.actor, params.input);
  if (!facultyId) return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  const c = await getCommitment(params.input.id);
  if (!c || c.facultyId !== facultyId || c.cancelledAt) {
    return { status: 404, body: { success: false, error: "Compromisso não encontrado" } } as const;
  }
  if (params.actor.role === "LEADER" && params.actor.cohortId && params.actor.cohortId !== c.cohortId) {
    return { status: 403, body: { success: false, error: "Você só mexe na agenda da sua turma" } } as const;
  }

  const autor = params.actor.realUserId ?? params.actor.id;
  const ofertasCanceladas = await cancelCommitment({ id: c.id, cancelledBy: autor });
  await logAudit({
    userId: autor,
    action: "COMMITMENT_CANCELLED",
    entity: "cohort_commitments",
    entityId: c.id,
    payload: { facultyId, title: c.title, date: c.date, ofertasCanceladas },
  });
  return { status: 200, body: { success: true, data: { ofertasCanceladas } } } as const;
}
