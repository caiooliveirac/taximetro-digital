/**
 * Ferramentas da Luna do interno. Todas só LEEM, e só o que o próprio interno
 * já pode ver no app — a Luna nunca escreve nada: ela aponta a tela ou a
 * conversa onde o interno age.
 *
 * Vaga liberada por outra faculdade só aparece para quem ainda está abaixo da
 * meta naquele tipo (USA/CRU/CRL) — a mesma trava do líder em
 * claim-extra-offer.ts. Quem escala na vaga continua sendo o líder.
 */

import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assignments, bases, userRoles, users } from "@/db/schema";
import { executeGetComplianceOverview } from "@/features/compliance/application/use-cases/get-compliance-overview";
import { listExtraOffers, listFreeOffers } from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import { executeListRequests } from "@/features/requests/application/use-cases/list-requests";
import { getRequestableSlots } from "@/lib/slots";
import { goalKindOf, type GoalKind } from "@/lib/goal-slots";
import { descreveTurno, plantaoSemDescanso, type TurnoDePlantao } from "@/shared/domain/policies/rest-policy";
import { addDaysToDateStr } from "@/lib/utils";

export type LunaCtx = { internId: string; facultyId: string | null; hoje: string };

/** Plantão que o interno já tem, no formato da regra de descanso. */
type Meu = TurnoDePlantao & { tipo: string; status: string };

/** Cartões que a tela monta a partir do resultado das ferramentas (não do texto do modelo). */
export type LunaItem = { titulo: string; detalhe?: string; href?: string; acao?: string; mapa?: string };
export type LunaCartao = { tipo: "vagas" | "trocas" | "extras" | "grade" | "plantoes"; titulo: string; itens: LunaItem[]; verTudo?: { href: string; rotulo: string } };

const MAX_ITENS = 12;
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function turnoCurto(date: string, period: string, shift?: string | null) {
  const d = date.slice(0, 10);
  const [, mes, dia] = d.split("-");
  const turno = shift === "MORNING" ? "manhã" : shift === "AFTERNOON" ? "tarde" : period === "NIGHT" ? "noite" : "dia";
  return `${DIAS[new Date(d + "T12:00:00Z").getUTCDay()]} ${dia}/${mes} ${turno}`;
}

const TIPO: Record<string, string> = { USA: "USA", CENTRAL: "CRU", CRL: "CRL" };

async function meusPlantoes(ctx: LunaCtx): Promise<Meu[]> {
  const rows = await db
    .select({
      date: assignments.date,
      period: assignments.period,
      shift: assignments.shift,
      status: assignments.status,
      baseCode: bases.code,
      tipo: bases.type,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .where(and(
      eq(assignments.internId, ctx.internId),
      gte(assignments.date, addDaysToDateStr(ctx.hoje, -1)),
      inArray(assignments.status, ["SCHEDULED", "CONFIRMED", "CHECKED_IN"]),
    ))
    .orderBy(assignments.date, assignments.period);
  return rows.map((r) => ({ ...r, date: String(r.date).slice(0, 10), period: r.period as "DAY" | "NIGHT" }));
}

async function metaDoInterno(ctx: LunaCtx) {
  const { data } = await executeGetComplianceOverview({
    actor: { id: ctx.internId, role: "COORDINATOR", facultyId: null },
    internId: ctx.internId,
  });
  return data.find((r) => r.userId === ctx.internId) ?? null;
}

/** Quem escala o interno: líder(es) ativo(s) da faculdade dele, sem ele mesmo. */
async function lideres(ctx: LunaCtx) {
  if (!ctx.facultyId) return [];
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
  return rows.filter((r) => r.id !== ctx.internId);
}

/**
 * Das vagas liberadas, as que servem a este interno: o tipo dela ainda tem
 * casinha vazia na meta dele, e ele não fica sem 12h de descanso. Pura, para
 * teste.
 */
export function vagasParaInterno<V extends { baseCode: string; baseType: string; date: string; period: string; shift?: string | null }>(
  vagas: V[],
  faltam: Partial<Record<GoalKind, number>>,
  meus: TurnoDePlantao[],
) {
  return vagas
    .map((v) => {
      const kind = goalKindOf(v.baseType);
      const turno: TurnoDePlantao = { date: String(v.date).slice(0, 10), period: v.period as "DAY" | "NIGHT", shift: v.shift, baseCode: v.baseCode };
      const choque = plantaoSemDescanso(turno, meus);
      return { vaga: v, kind, choque };
    })
    .filter((x) => x.kind && (faltam[x.kind] ?? 0) > 0);
}

type Resultado = { dados: unknown; cartao?: LunaCartao };

async function meuResumo(ctx: LunaCtx): Promise<Resultado> {
  const [meta, meus] = await Promise.all([metaDoInterno(ctx), meusPlantoes(ctx)]);
  const proximos = meus.filter((m) => m.date >= ctx.hoje).slice(0, 15);
  return {
    dados: {
      hoje: ctx.hoje,
      faculdade: meta?.facultyAbbr ?? null,
      rotacao: meta ? { inicio: meta.rotationStartDate, fim: meta.rotationEndDate } : null,
      meta: meta
        ? {
            USA: { meta: meta.targetUSATotal, faltam_escalar: meta.missingUSA },
            CRU: { meta: meta.targetCRUTotal, faltam_escalar: meta.missingCRU },
            CRL: { meta: meta.targetCRLTotal, faltam_escalar: meta.missingCRL },
            explicacao: "faltam_escalar = casinhas da meta sem plantão marcado (realizados, o de hoje e os agendados já contam). Extra não conta para a meta.",
          }
        : "sem meta encontrada para este interno",
      realizados: meta?.totalCompleted ?? null,
      faltas: meta?.totalAbsent ?? null,
      proximos_plantoes: proximos.map((p) => ({ base: p.baseCode, tipo: TIPO[p.tipo] ?? p.tipo, quando: turnoCurto(p.date, p.period, p.shift), status: p.status })),
    },
    cartao: proximos.length
      ? {
          tipo: "plantoes",
          titulo: "Seus próximos plantões",
          itens: proximos.slice(0, 6).map((p) => ({ titulo: `${p.baseCode} · ${turnoCurto(p.date, p.period, p.shift)}`, detalhe: TIPO[p.tipo] ?? p.tipo, mapa: p.baseCode })),
          verTudo: { href: "/intern/calendario", rotulo: "Abrir calendário" },
        }
      : undefined,
  };
}

async function vagasLiberadas(ctx: LunaCtx, args: { dias?: number }): Promise<Resultado> {
  if (!ctx.facultyId) return { dados: { erro: "interno sem faculdade vinculada" } };
  const dias = Math.min(Math.max(Number(args.dias) || 21, 1), 45);
  const [meta, meus, vagas, lider] = await Promise.all([
    metaDoInterno(ctx),
    meusPlantoes(ctx),
    listFreeOffers({ excludeFacultyId: ctx.facultyId, from: ctx.hoje, to: addDaysToDateStr(ctx.hoje, dias) }),
    lideres(ctx),
  ]);
  const faltam = { USA: meta?.missingUSA ?? 0, CRU: meta?.missingCRU ?? 0, CRL: meta?.missingCRL ?? 0 };
  const servem = vagasParaInterno(vagas.map((v) => ({ ...v, date: String(v.date) })), faltam, meus);
  const livres = servem.filter((s) => !s.choque);
  const lid = lider[0] ?? null;

  const regra = "Vaga liberada por outra faculdade só é para quem ainda tem casinha vazia na meta daquele tipo. Quem escala o interno na vaga é o líder da faculdade dele (tela Montar escala); o interno pede ao líder.";
  return {
    dados: {
      janela: { de: ctx.hoje, ate: addDaysToDateStr(ctx.hoje, dias) },
      faltam_escalar_na_meta: faltam,
      total_liberadas_na_janela: vagas.length,
      para_voce: livres.slice(0, MAX_ITENS).map((s) => ({
        base: s.vaga.baseCode,
        tipo: s.kind,
        quando: turnoCurto(s.vaga.date, s.vaga.period, s.vaga.shift),
        liberada_por: s.vaga.releasedFacultyAbbr ?? "sem dono na grade",
      })),
      para_voce_total: livres.length,
      bateriam_com_seus_plantoes: servem.filter((s) => s.choque).slice(0, 5).map((s) => ({
        base: s.vaga.baseCode,
        quando: turnoCurto(s.vaga.date, s.vaga.period, s.vaga.shift),
        motivo: `sem 12h de descanso por causa de ${descreveTurno(s.choque!)}`,
      })),
      lider: lid?.nome ?? "nenhum líder ativo cadastrado",
      regra,
    },
    cartao: livres.length
      ? {
          tipo: "vagas",
          titulo: "Vagas liberadas para você",
          itens: livres.slice(0, 6).map((s) => {
            const quando = turnoCurto(s.vaga.date, s.vaga.period, s.vaga.shift);
            const texto = `Oi! Tem vaga liberada ${s.kind} na ${s.vaga.baseCode}, ${quando}, e ainda me falta ${s.kind} na meta. Pode me escalar nela?`;
            return {
              titulo: `${s.vaga.baseCode} · ${quando}`,
              detalhe: `${s.kind} · liberada por ${s.vaga.releasedFacultyAbbr ?? "sem dono"}`,
              mapa: s.vaga.baseCode,
              ...(lid ? { href: `/intern/mensagens?com=${lid.id}&texto=${encodeURIComponent(texto)}`, acao: "Pedir ao líder" } : {}),
            };
          }),
        }
      : undefined,
  };
}

async function extrasAbertos(ctx: LunaCtx): Promise<Resultado> {
  const [extras, meus] = await Promise.all([listExtraOffers(), meusPlantoes(ctx)]);
  const lista = extras.map((e) => {
    const date = String(e.date).slice(0, 10);
    const choque = plantaoSemDescanso({ date, period: e.period as "DAY" | "NIGHT", shift: e.shift, baseCode: e.baseCode }, meus);
    return { e, date, choque };
  });
  const ok = lista.filter((x) => !x.choque);
  return {
    dados: {
      regra: "Extra é o primeiro que pegar, na aba Extras. Extra não conta para a meta.",
      extras: ok.slice(0, MAX_ITENS).map(({ e, date }) => ({
        base: e.baseCode,
        tipo: TIPO[e.baseType] ?? e.baseType,
        quando: turnoCurto(date, e.period, e.shift),
        observacao: e.notes ?? null,
      })),
      total: ok.length,
      bateriam_com_seus_plantoes: lista.length - ok.length,
    },
    cartao: ok.length
      ? {
          tipo: "extras",
          titulo: "Extras abertos",
          itens: ok.slice(0, 6).map(({ e, date }) => ({ titulo: `${e.baseCode} · ${turnoCurto(date, e.period, e.shift)}`, detalhe: TIPO[e.baseType] ?? e.baseType, mapa: e.baseCode })),
          verTudo: { href: "/intern/extras", rotulo: "Pegar na aba Extras" },
        }
      : undefined,
  };
}

async function trocasAbertas(ctx: LunaCtx): Promise<Resultado> {
  const [ofertas, meus] = await Promise.all([
    executeListRequests({ actor: { id: ctx.internId, role: "INTERN", facultyId: ctx.facultyId }, scope: "open-swaps" }),
    meusPlantoes(ctx),
  ]);
  const futuros = meus.filter((m) => m.date >= ctx.hoje && ["SCHEDULED", "CONFIRMED"].includes(m.status));
  const lista = ofertas.map((o) => {
    const tipo = TIPO[o.baseType ?? ""] ?? o.baseType ?? "?";
    const date = String(o.assignmentDate ?? "").slice(0, 10);
    return {
      o,
      tipo,
      quando: date ? turnoCurto(date, o.assignmentPeriod ?? "DAY", o.assignmentShift) : "?",
      meus_do_mesmo_tipo: futuros.filter((m) => (TIPO[m.tipo] ?? m.tipo) === tipo).length,
    };
  });
  return {
    dados: {
      regra: "Troca é do mesmo tipo (USA↔USA, CRU↔CRU, CRL↔CRL), com 12h de descanso; CRU troca uma vez por rodízio. USA vale com interno de qualquer faculdade; CRU e CRL, só da mesma. Vale quando quem ofereceu confirma.",
      ofertas: lista.slice(0, MAX_ITENS).map((x) => ({ de: x.o.requesterName, faculdade: x.o.facultyAbbr, base: x.o.baseCode, tipo: x.tipo, quando: x.quando, voce_tem_do_mesmo_tipo_para_oferecer: x.meus_do_mesmo_tipo })),
      total: lista.length,
      seus_plantoes_que_pode_oferecer: futuros.slice(0, 10).map((m) => ({ base: m.baseCode, tipo: TIPO[m.tipo] ?? m.tipo, quando: turnoCurto(m.date, m.period, m.shift) })),
    },
    cartao: lista.length
      ? {
          tipo: "trocas",
          titulo: "Ofertas de troca dos colegas",
          itens: lista.slice(0, 6).map((x) => ({
            titulo: `${x.o.baseCode} · ${x.quando}`,
            detalhe: `${x.tipo} · ${x.o.requesterName}${x.o.facultyAbbr ? ` (${x.o.facultyAbbr})` : ""}`,
            href: `/intern/mensagens?com=${x.o.requesterId}&troca=${x.o.id}&texto=${encodeURIComponent(`Oi! Vi sua oferta do ${x.o.baseCode} (${x.quando}). Tenho interesse — o que você procura em troca?`)}`,
            acao: "Conversar",
          })),
          verTudo: { href: "/intern/trocas", rotulo: "Propor troca em Trocas" },
        }
      : undefined,
  };
}

async function vagasDaGrade(ctx: LunaCtx): Promise<Resultado> {
  if (!ctx.facultyId) return { dados: { erro: "interno sem faculdade vinculada" } };
  const slots = await getRequestableSlots(ctx.facultyId, ctx.internId);
  return {
    dados: {
      regra: "Vaga sobrando na grade da sua própria faculdade. Você pede na aba Trocas → Extra, e o líder ou a coordenação aprova.",
      vagas: slots.slice(0, MAX_ITENS).map((s) => ({ base: s.baseCode, tipo: TIPO[s.baseType ?? ""] ?? s.baseType, quando: turnoCurto(s.nextDate, s.period), sobrando: s.available })),
      total: slots.length,
    },
    cartao: slots.length
      ? {
          tipo: "grade",
          titulo: "Sobrando na grade da sua faculdade",
          itens: slots.slice(0, 6).map((s) => ({ titulo: `${s.baseCode} · ${turnoCurto(s.nextDate, s.period)}`, detalhe: `${TIPO[s.baseType ?? ""] ?? s.baseType} · ${s.available} vaga(s)`, mapa: s.baseCode })),
          verTudo: { href: "/intern/trocas", rotulo: "Pedir em Trocas → Extra" },
        }
      : undefined,
  };
}

export const FERRAMENTAS: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (ctx: LunaCtx, args: Record<string, unknown>) => Promise<Resultado>;
}[] = [
  {
    name: "meu_resumo",
    description: "Meta do interno por tipo (USA, CRU, CRL) e quanto falta escalar, realizados, faltas e os próximos plantões dele. Use para perguntas sobre meta, agenda e próximo plantão.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: (ctx) => meuResumo(ctx),
  },
  {
    name: "vagas_liberadas",
    description: "Vagas que OUTRAS faculdades liberaram (ou sem dono), filtradas para este interno: só tipos em que ele ainda está abaixo da meta e sem quebrar 12h de descanso. Inclui o nome do líder que escala.",
    parameters: {
      type: "object",
      properties: { dias: { type: "integer", description: "Quantos dias à frente olhar (padrão 21, máximo 45)." } },
      additionalProperties: false,
    },
    run: (ctx, args) => vagasLiberadas(ctx, args as { dias?: number }),
  },
  {
    name: "extras_abertos",
    description: "Plantões extras publicados pela coordenação/líderes, abertos para o primeiro que pegar, sem os que bateriam com os plantões do interno.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: (ctx) => extrasAbertos(ctx),
  },
  {
    name: "trocas_abertas",
    description: "Ofertas de troca abertas que o interno pode pegar (da faculdade dele, de qualquer tipo; de outras faculdades, só USA), e os plantões dele que poderiam entrar na troca.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: (ctx) => trocasAbertas(ctx),
  },
  {
    name: "vagas_da_grade",
    description: "Vagas sobrando na grade fixa da própria faculdade do interno, que ele pode pedir como plantão a mais (aprovação do líder).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: (ctx) => vagasDaGrade(ctx),
  },
];
