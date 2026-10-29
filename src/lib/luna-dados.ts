/**
 * Acesso a dados da Luna: cada fonte é lida no máximo uma vez por pergunta
 * (memo por pedido) e sempre escopada pelo interno autenticado — o modelo
 * nunca escolhe de quem é o dado. Tudo reaproveita os casos de uso que as
 * telas já usam; não há consulta paralela às regras deles.
 *
 * O catálogo do que existe no banco e por que estas são as fontes certas está
 * em docs/luna-catalogo.md.
 */

import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { assignments, bases, checkins, userRoles, users } from "@/db/schema";
import { executeGetComplianceOverview } from "@/features/compliance/application/use-cases/get-compliance-overview";
import { listExtraOffers, listFreeOffers } from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import { executeListRequests } from "@/features/requests/application/use-cases/list-requests";
import { findInternOverCruQuota, findSwapRestConflict } from "@/features/requests/application/use-cases/handle-swap-peer-action";
import { findPendingRequestByAssignment } from "@/features/requests/infra/repositories/request-repository";
import { getRequestableSlots } from "@/lib/slots";
import { soAsQueCabem } from "@/features/extra-offers/application/lotacao";
import { goalKindOf } from "@/lib/goal-slots";
import { situacaoDoTurnoNaBase, type SituacaoDoTurno } from "@/features/scheduling/infra/repositories/plantoes-medicos-repository";
import { filaDeReposicao, type Fila } from "@/features/extra-offers/application/fila-de-reposicao";
import { addDaysToDateStr, hasShiftStarted, operationalDateStr } from "@/lib/utils";
import type { Meta, MeuPlantao, Oferta, Periodo } from "@/lib/luna-inteligencia";

export type LunaCtx = { internId: string; facultyId: string | null; hoje: string };

export type Fontes = {
  meta(): Promise<Meta | null>;
  /** Quem precisa de reposição × vagas livres abertas, por tipo (agregado, cache de 10 min). */
  fila(): Promise<Fila>;
  /** Bases ativas do app (código e nome), para achar a base citada na pergunta. */
  bases(): Promise<{ code: string; name: string }[]>;
  /** Quadro de médicos do `plantoes` para a base num turno (quem chegou, quem sai, desativada). */
  situacaoDoTurno(codigo: string, inicioDoTurno: Date): Promise<SituacaoDoTurno>;
  /** Do rodízio recente em diante, com presença; inclui cancelados (para explicar). */
  meusPlantoes(): Promise<MeuPlantao[]>;
  lider(): Promise<{ id: string; nome: string } | null>;
  liberadas(ate: string): Promise<Oferta[]>;
  extras(): Promise<Oferta[]>;
  grade(): Promise<Oferta[]>;
  trocas(): Promise<Oferta[]>;
  /** Regras da troca que dependem do colega: descanso dele, cota de CRU, pedido pendente. */
  conferirTroca(oferta: Oferta, meu: MeuPlantao): Promise<string | null>;
};

export type RegistroFonte = { fonte: string; ms: number; n: number; ok: boolean };

/** Olha ~2 meses para trás: cobre o rodízio corrente para presença e explicação. */
const PASSADO_DIAS = 75;

const dia = (d: unknown) => String(d).slice(0, 10);
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

export function criarFontes(ctx: LunaCtx, registrar: (r: RegistroFonte) => void = () => {}): Fontes {
  const cache = new Map<string, Promise<unknown>>();
  function lido<T>(fonte: string, ler: () => Promise<T>): Promise<T> {
    if (!cache.has(fonte)) {
      const t0 = Date.now();
      cache.set(fonte, ler().then(
        (v) => (registrar({ fonte, ms: Date.now() - t0, n: Array.isArray(v) ? v.length : v ? 1 : 0, ok: true }), v),
        (e) => (registrar({ fonte, ms: Date.now() - t0, n: 0, ok: false }), Promise.reject(e)),
      ));
    }
    return cache.get(fonte) as Promise<T>;
  }

  return {
    meta: () => lido("meta", async () => {
      // Mesmo cálculo da tela do interno e do cockpit (casinhas da meta). O
      // internId vem da sessão, nunca do modelo.
      const { data } = await executeGetComplianceOverview({ actor: { id: ctx.internId, role: "COORDINATOR", facultyId: null }, internId: ctx.internId });
      const r = data.find((x) => x.userId === ctx.internId);
      if (!r) return null;
      return {
        faculdade: r.facultyAbbr ?? null,
        inicio: r.rotationStartDate ? dia(r.rotationStartDate) : null,
        fim: r.rotationEndDate ? dia(r.rotationEndDate) : null,
        alvo: { USA: r.targetUSATotal, CRU: r.targetCRUTotal, CRL: r.targetCRLTotal },
        faltam: { USA: r.missingUSA, CRU: r.missingCRU, CRL: r.missingCRL },
        realizados: r.totalCompleted,
        faltas: r.totalAbsent,
      } satisfies Meta;
    }),

    fila: () => lido("fila", () => filaDeReposicao()),

    bases: () => lido("bases", () => db.select({ code: bases.code, name: bases.name }).from(bases).where(eq(bases.isActive, true))),

    situacaoDoTurno: (codigo, inicio) => lido(`plantoes:${codigo}:${inicio.toISOString()}`, () => situacaoDoTurnoNaBase(codigo, inicio)),

    meusPlantoes: () => lido("meus_plantoes", async () => {
      const rows = await db
        .select({
          id: assignments.id,
          date: assignments.date,
          period: assignments.period,
          shift: assignments.shift,
          status: assignments.status,
          isExtraShift: assignments.isExtraShift,
          absenceJustification: assignments.absenceJustification,
          baseCode: bases.code,
          baseType: bases.type,
          checkinStatus: checkins.status,
          totpValidatedAt: checkins.totpValidatedAt,
          checkoutAt: checkins.checkoutAt,
          checkoutNotes: checkins.checkoutNotes,
        })
        .from(assignments)
        .innerJoin(bases, eq(bases.id, assignments.baseId))
        .leftJoin(checkins, eq(checkins.assignmentId, assignments.id))
        .where(and(eq(assignments.internId, ctx.internId), gte(assignments.date, addDaysToDateStr(ctx.hoje, -PASSADO_DIAS))))
        .orderBy(assignments.date, assignments.period)
        .limit(300);
      return rows.map((r): MeuPlantao => ({
        id: r.id,
        date: dia(r.date),
        period: r.period as Periodo,
        shift: r.shift,
        status: r.status,
        baseCode: r.baseCode,
        tipo: goalKindOf(r.baseType),
        isExtraShift: r.isExtraShift,
        justificativa: Boolean(r.absenceJustification?.trim()),
        checkinStatus: r.checkinStatus ?? null,
        totpValidatedAt: iso(r.totpValidatedAt),
        checkoutAt: iso(r.checkoutAt),
        checkoutNotes: r.checkoutNotes ?? null,
      }));
    }),

    lider: () => lido("lider", async () => {
      if (!ctx.facultyId) return null;
      const rows = await db
        .selectDistinct({ id: users.id, nome: users.name })
        .from(userRoles)
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(and(
          eq(userRoles.role, "LEADER"),
          eq(userRoles.facultyId, ctx.facultyId),
          eq(userRoles.isActive, true),
          eq(userRoles.isArchived, false),
          eq(users.isActive, true),
        ));
      return rows.find((r) => r.id !== ctx.internId) ?? null;
    }),

    liberadas: (ate) => lido(`liberadas:${ate}`, async () => {
      if (!ctx.facultyId) return [];
      const vagas = (await listFreeOffers({ excludeFacultyId: ctx.facultyId, from: ctx.hoje, to: ate }))
        .filter((v) => !hasShiftStarted(dia(v.date), v.period as Periodo, v.shift));
      return soAsQueCabem(vagas.map((v): Oferta => ({
        fonte: "LIBERADA", id: v.id, baseCode: v.baseCode, tipo: goalKindOf(v.baseType),
        date: dia(v.date), period: v.period as Periodo, shift: v.shift, faculdade: v.releasedFacultyAbbr ?? null,
      })));
    }),

    extras: () => lido("extras", async () => {
      const extras = await listExtraOffers();
      return soAsQueCabem(extras.map((e): Oferta => ({
        fonte: "EXTRA", id: e.id, baseCode: e.baseCode, tipo: goalKindOf(e.baseType),
        date: dia(e.date), period: e.period as Periodo, shift: e.shift, obs: e.notes ?? null,
      })));
    }),

    grade: () => lido("grade", async () => {
      if (!ctx.facultyId) return [];
      const slots = await getRequestableSlots(ctx.facultyId, ctx.internId);
      return slots
        // Turno que já começou não é vaga para pedir.
        .filter((s) => !hasShiftStarted(dia(s.nextDate), s.period as Periodo, null))
        .map((s): Oferta => ({
          fonte: "GRADE", id: `${s.baseId}|${s.nextDate}|${s.period}`, baseCode: s.baseCode, tipo: goalKindOf(s.baseType),
          date: dia(s.nextDate), period: s.period as Periodo, shift: null,
        }));
    }),

    trocas: () => lido("trocas", async () => {
      // Mesmo recorte da aba Trocas: da própria faculdade, qualquer tipo; de outra, só USA.
      const ofertas = await executeListRequests({ actor: { id: ctx.internId, role: "INTERN", facultyId: ctx.facultyId }, scope: "open-swaps" });
      return ofertas
        .filter((o) => o.assignmentDate)
        .map((o): Oferta => ({
          fonte: "TROCA", id: o.id, baseCode: o.baseCode ?? "?", tipo: goalKindOf(o.baseType),
          date: dia(o.assignmentDate), period: (o.assignmentPeriod ?? "DAY") as Periodo, shift: o.assignmentShift ?? null,
          quem: o.requesterName, quemId: o.requesterId, assignmentId: o.assignmentId, faculdade: o.facultyAbbr ?? null,
        }));
    }),

    conferirTroca: async (oferta, meu) => {
      const t0 = Date.now();
      try {
        if (!oferta.assignmentId || !oferta.quemId) return "Essa oferta está incompleta.";
        if (await findPendingRequestByAssignment(meu.id)) return "Seu plantão já está em outra solicitação pendente.";
        if (oferta.tipo === "CRU") {
          const quem = await findInternOverCruQuota([oferta.quemId, ctx.internId], operationalDateStr());
          if (quem) return `${quem} já trocou um plantão de CRU neste rodízio (é uma troca de CRU por rodízio).`;
        }
        return await findSwapRestConflict(oferta.assignmentId, meu.id);
      } finally {
        registrar({ fonte: "conferir_troca", ms: Date.now() - t0, n: 1, ok: true });
      }
    },
  };
}
