/**
 * Avisos que a Dai deixa no chat do app, por cron (scripts/container-entrypoint.sh):
 *
 *  - plantao: na véspera, o plantão de amanhã, onde fica a base e um tema
 *    para revisar.
 *  - vagas:   vaga livre que abriu, cabe na viatura (lotacao.ts) e serve a
 *    quem ainda precisa daquele tipo — todos recebem, no máximo uma
 *    mensagem por interno por dia.
 *  - lideres: de manhã, ao líder, o que da grade da faculdade está sem escala
 *    nos próximos 7 dias e quantos internos ainda precisam.
 *  - trocas:  oferta de troca que apareceu num turno em que o interno marcou
 *    Quero/Posso no calendário e que ele consegue fechar (swap-match-policy.ts).
 *    Feature `avisoDeTrocas`: desligada até o texto ser aprovado; `?dry=1`
 *    monta e mostra a amostra sem enviar.
 *
 * Texto pronto (textos.ts), sem modelo. Cada envio fica no audit_log
 * (DAI_AVISO_*): é o que impede repetir. Só lê para decidir; escreve só a
 * mensagem e o registro.
 */

import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, auditLog, bases, cohorts, extraShiftOffers, faculties, internMessages, userRoles, users } from "@/db/schema";
import { executeGetComplianceOverview } from "@/features/compliance/application/use-cases/get-compliance-overview";
import { AUDIT_CASO_ABERTO } from "@/lib/dai-casos";
import { GOAL_KINDS, goalKindOf, type GoalKind } from "@/lib/goal-slots";
import { quando } from "@/lib/luna-inteligencia";
import { addDaysToDateStr, hasShiftStarted, localDateStr } from "@/lib/utils";
import { plantaoSemDescanso, type TurnoDePlantao } from "@/shared/domain/policies/rest-policy";
import { soAsQueCabem } from "@/features/extra-offers/application/lotacao";
import { idDaDai } from "./remetente";
import { temaParaPlantao, textoProximoPlantao, textoSobraParaLider, textoTrocasNosTurnosMarcados, textoVagasAbertas, type VagaAvisada } from "./textos";
import { carregarMercado, type FotografiaDoMercado } from "@/features/requests/application/use-cases/load-swap-market";
import { findInternOverCruQuota } from "@/features/requests/application/use-cases/handle-swap-peer-action";
import { avaliarOferta, visivelPara, type Avaliacao, type OfertaAberta } from "@/shared/domain/policies/swap-match-policy";

export const AVISO = { PLANTAO: "DAI_AVISO_PLANTAO", VAGAS: "DAI_AVISO_VAGAS", SOBRA: "DAI_AVISO_SOBRA", TROCAS: "DAI_AVISO_TROCAS" } as const;
export type TipoDeAviso = "plantao" | "vagas" | "lideres" | "trocas";
export type ResultadoDosAvisos = { tipo: TipoDeAviso; enviados: number; considerados: number; dry: boolean; amostra?: string };

type Envio = { para: string; texto: string; action: string; entityId: string; payload: Record<string, unknown> };

const VAGAS_POR_AVISO = 3;
const JANELA_VAGAS_DIAS = 10;
const JANELA_SOBRA_DIAS = 7;
/** "Hoje" para não repetir: 20h cobre o dia sem depender do fuso do audit_log. */
const UM_DIA_MS = 20 * 60 * 60_000;

const dia = (d: unknown) => String(d).slice(0, 10);

async function enviar(envios: Envio[], dry: boolean) {
  if (dry || envios.length === 0) return;
  const dai = await idDaDai({ criar: true });
  if (!dai) throw new Error("Dai sem usuário");
  await db.transaction(async (tx) => {
    await tx.insert(internMessages).values(envios.map((e) => ({ fromUserId: dai, toUserId: e.para, body: e.texto })));
    await tx.insert(auditLog).values(envios.map((e) => ({ userId: dai, action: e.action, entity: "dai_aviso", entityId: e.entityId, payload: { para: e.para, ...e.payload } })));
  });
}

// ---------------------------------------------------------------------------

async function avisarPlantao(now: Date, dry: boolean): Promise<ResultadoDosAvisos> {
  const amanha = addDaysToDateStr(localDateStr(now), 1);
  const rows = await db
    .select({ id: assignments.id, internId: assignments.internId, date: assignments.date, period: assignments.period, shift: assignments.shift, baseCode: bases.code, baseType: bases.type })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(users, eq(users.id, assignments.internId))
    .where(and(eq(assignments.date, amanha), inArray(assignments.status, ["SCHEDULED", "CONFIRMED"]), eq(users.isActive, true)))
    .orderBy(assignments.period, assignments.shift);
  if (!rows.length) return { tipo: "plantao", enviados: 0, considerados: 0, dry };

  const ids = rows.map((r) => r.id);
  const internos = [...new Set(rows.map((r) => r.internId))];
  const [avisados, temas] = await Promise.all([
    db.select({ id: auditLog.entityId }).from(auditLog).where(and(eq(auditLog.action, AVISO.PLANTAO), inArray(auditLog.entityId, ids))),
    // Temas já abertos na Dai, e os já sugeridos: a sugestão anda.
    db.select({ userId: auditLog.userId, para: sql<string | null>`${auditLog.payload}->>'para'`, tema: sql<string | null>`${auditLog.payload}->>'tema'` })
      .from(auditLog)
      .where(or(
        and(eq(auditLog.action, AUDIT_CASO_ABERTO), inArray(auditLog.userId, internos)),
        and(eq(auditLog.action, AVISO.PLANTAO), gte(auditLog.createdAt, new Date(now.getTime() - 60 * 24 * 60 * 60_000))),
      )),
  ]);
  const jaAvisado = new Set(avisados.map((a) => a.id));
  const vistos = new Map<string, Set<string>>();
  for (const t of temas) {
    const quem = t.para ?? t.userId;
    if (!quem || !t.tema) continue;
    vistos.set(quem, (vistos.get(quem) ?? new Set()).add(t.tema));
  }

  const envios: Envio[] = [];
  const porInterno = new Set<string>();
  for (const r of rows) {
    // Um aviso por interno: o primeiro turno do dia.
    if (jaAvisado.has(r.id) || porInterno.has(r.internId)) continue;
    porInterno.add(r.internId);
    const tipo = goalKindOf(r.baseType);
    const tema = temaParaPlantao(tipo, vistos.get(r.internId) ?? [], amanha);
    envios.push({
      para: r.internId,
      texto: textoProximoPlantao({ quando: quando(dia(r.date), r.period, r.shift), baseCode: r.baseCode, tipo, tema }),
      action: AVISO.PLANTAO,
      entityId: r.id,
      payload: { tema, base: r.baseCode, data: amanha },
    });
  }
  await enviar(envios, dry);
  return { tipo: "plantao", enviados: envios.length, considerados: rows.length, dry, amostra: envios[0]?.texto };
}

// ---------------------------------------------------------------------------

type Vaga = { id: string; baseCode: string; tipo: GoalKind; date: string; period: "DAY" | "NIGHT"; shift: string | null; releasedFacultyId: string | null; liberadaPor: string | null };

const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);

/**
 * Para cada interno que ainda precisa de um tipo, as vagas livres abertas que
 * cabem: do tipo que falta, dentro do rodízio dele, não liberadas pela própria
 * faculdade, sem plantão no turno e com 12h de descanso. Todos que precisam
 * recebem; para não mandar as mesmas 3 vagas a todo mundo, quem tem mais
 * casinha vazia por dia de rodízio que resta escolhe primeiro e cada um
 * recebe as vagas menos citadas até ali. Pura, para teste.
 */
export function vagasParaCadaInterno(
  vagas: Vaga[],
  internos: { userId: string; facultyId: string | null; inicio: string | null; fim: string | null; faltam: Record<GoalKind, number> }[],
  turnosDe: Map<string, TurnoDePlantao[]>,
  jaAvisadas: Map<string, Set<string>>,
  hoje: string,
) {
  const urgencia = (i: (typeof internos)[number]) =>
    GOAL_KINDS.reduce((s, k) => s + i.faltam[k], 0) / Math.max(1, i.fim ? diasEntre(hoje, i.fim) : 60);
  const citacoes = new Map<string, number>();
  const saida = new Map<string, Vaga[]>();
  for (const i of [...internos].sort((a, b) => urgencia(b) - urgencia(a))) {
    const turnos = turnosDe.get(i.userId) ?? [];
    const avisadas = jaAvisadas.get(i.userId) ?? new Set();
    const servem = vagas.filter((v) =>
      i.faltam[v.tipo] > 0 &&
      (!i.inicio || v.date >= i.inicio) && (!i.fim || v.date <= i.fim) &&
      v.releasedFacultyId !== i.facultyId &&
      !avisadas.has(v.id) &&
      !plantaoSemDescanso({ date: v.date, period: v.period, shift: v.shift, baseCode: v.baseCode }, turnos),
    )
      .sort((a, b) => (citacoes.get(a.id) ?? 0) - (citacoes.get(b.id) ?? 0) || `${a.date}${a.period}`.localeCompare(`${b.date}${b.period}`))
      .slice(0, VAGAS_POR_AVISO)
      .sort((a, b) => `${a.date}${a.period === "DAY" ? 0 : 1}`.localeCompare(`${b.date}${b.period === "DAY" ? 0 : 1}`));
    if (!servem.length) continue;
    for (const v of servem) citacoes.set(v.id, (citacoes.get(v.id) ?? 0) + 1);
    saida.set(i.userId, servem);
  }
  return saida;
}

async function avisarVagas(now: Date, dry: boolean): Promise<ResultadoDosAvisos> {
  const hoje = localDateStr(now);
  const ate = addDaysToDateStr(hoje, JANELA_VAGAS_DIAS - 1);
  const ofertas = await db
    .select({ id: extraShiftOffers.id, baseCode: bases.code, baseType: bases.type, date: extraShiftOffers.date, period: extraShiftOffers.period, shift: extraShiftOffers.shift, releasedFacultyId: extraShiftOffers.releasedFacultyId, liberadaPor: faculties.abbreviation })
    .from(extraShiftOffers)
    .innerJoin(bases, eq(bases.id, extraShiftOffers.baseId))
    .leftJoin(faculties, eq(faculties.id, extraShiftOffers.releasedFacultyId))
    .where(and(
      or(isNotNull(extraShiftOffers.releasedFacultyId), eq(extraShiftOffers.autoRelease, "SEM_DONO")),
      isNull(extraShiftOffers.claimedBy), isNull(extraShiftOffers.cancelledAt), isNull(extraShiftOffers.reservedBy),
      // Vaga de hoje não dá tempo de pedir ao líder e ele escalar.
      gte(extraShiftOffers.date, addDaysToDateStr(hoje, 1)), lte(extraShiftOffers.date, ate),
    ))
    .orderBy(extraShiftOffers.date, extraShiftOffers.period);
  const vagas: Vaga[] = await soAsQueCabem(ofertas
    .map((o) => ({ ...o, date: dia(o.date), period: o.period as "DAY" | "NIGHT", tipo: goalKindOf(o.baseType) }))
    .filter((o): o is typeof o & { tipo: GoalKind } => Boolean(o.tipo) && !hasShiftStarted(o.date, o.period, o.shift, now)));
  if (!vagas.length) return { tipo: "vagas", enviados: 0, considerados: 0, dry };

  const tiposAbertos = new Set(vagas.map((v) => v.tipo));
  const { data } = await executeGetComplianceOverview({ actor: { id: "", role: "COORDINATOR", facultyId: null } });
  const internos = data
    .map((r) => ({
      userId: r.userId,
      facultyId: r.facultyId ?? null,
      inicio: r.rotationStartDate ? dia(r.rotationStartDate) : null,
      fim: r.rotationEndDate ? dia(r.rotationEndDate) : null,
      faltam: { USA: r.missingUSA, CRU: r.missingCRU, CRL: r.missingCRL },
    }))
    .filter((i) => GOAL_KINDS.some((k) => tiposAbertos.has(k) && i.faltam[k] > 0));
  if (!internos.length) return { tipo: "vagas", enviados: 0, considerados: vagas.length, dry };

  const ids = internos.map((i) => i.userId);
  const [plantoes, historico] = await Promise.all([
    db.select({ internId: assignments.internId, date: assignments.date, period: assignments.period, shift: assignments.shift, baseCode: bases.code })
      .from(assignments)
      .innerJoin(bases, eq(bases.id, assignments.baseId))
      .where(and(inArray(assignments.internId, ids), ne(assignments.status, "CANCELLED"), gte(assignments.date, addDaysToDateStr(hoje, -1)), lte(assignments.date, addDaysToDateStr(ate, 1)))),
    db.select({ para: auditLog.entityId, payload: auditLog.payload, em: auditLog.createdAt })
      .from(auditLog)
      .where(and(eq(auditLog.action, AVISO.VAGAS), inArray(auditLog.entityId, ids), gte(auditLog.createdAt, new Date(now.getTime() - 15 * 24 * 60 * 60_000)))),
  ]);
  const turnosDe = new Map<string, TurnoDePlantao[]>();
  for (const p of plantoes) {
    turnosDe.set(p.internId, [...(turnosDe.get(p.internId) ?? []), { date: dia(p.date), period: p.period as "DAY" | "NIGHT", shift: p.shift, baseCode: p.baseCode }]);
  }
  const jaAvisadas = new Map<string, Set<string>>();
  const avisadoHoje = new Set<string>();
  for (const h of historico) {
    if (!h.para) continue;
    const s = jaAvisadas.get(h.para) ?? new Set<string>();
    for (const id of ((h.payload as { ofertas?: string[] } | null)?.ofertas ?? [])) s.add(id);
    jaAvisadas.set(h.para, s);
    if (now.getTime() - new Date(h.em).getTime() < UM_DIA_MS) avisadoHoje.add(h.para);
  }

  const porInterno = vagasParaCadaInterno(vagas, internos.filter((i) => !avisadoHoje.has(i.userId)), turnosDe, jaAvisadas, hoje);
  const envios: Envio[] = [...porInterno].map(([para, lista]) => ({
    para,
    texto: textoVagasAbertas(lista.map((v): VagaAvisada => ({ baseCode: v.baseCode, quando: quando(v.date, v.period, v.shift), tipo: v.tipo, liberadaPor: v.liberadaPor }))),
    action: AVISO.VAGAS,
    entityId: para,
    payload: { ofertas: lista.map((v) => v.id) },
  }));
  await enviar(envios, dry);
  return { tipo: "vagas", enviados: envios.length, considerados: internos.length, dry, amostra: envios[0]?.texto };
}

// ---------------------------------------------------------------------------

async function avisarLideres(now: Date, dry: boolean): Promise<ResultadoDosAvisos> {
  const hoje = localDateStr(now);
  const ate = addDaysToDateStr(hoje, JANELA_SOBRA_DIAS - 1);
  const [turmas, turnos, lideres, jaHoje] = await Promise.all([
    db.select({ facultyId: cohorts.facultyId, inicio: cohorts.startDate, fim: cohorts.endDate })
      .from(cohorts)
      .where(and(ne(cohorts.status, "CLOSED"), gte(cohorts.endDate, hoje), lte(cohorts.startDate, ate))),
    db.execute(sql`
      SELECT faculty_id, tipo, data::text AS data, SUM(sobra)::int AS sobra, SUM(liberadas_abertas + sem_dono_abertas)::int AS abertas
      FROM turnos_livres
      WHERE data BETWEEN ${hoje}::date AND ${ate}::date
      GROUP BY 1, 2, 3
    `) as unknown as Promise<{ faculty_id: string | null; tipo: string; data: string; sobra: number; abertas: number }[]>,
    db.selectDistinct({ id: users.id, facultyId: userRoles.facultyId, faculdade: faculties.abbreviation })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .innerJoin(faculties, eq(faculties.id, userRoles.facultyId))
      .where(and(eq(userRoles.role, "LEADER"), eq(userRoles.isActive, true), eq(userRoles.isArchived, false), eq(users.isActive, true))),
    db.select({ id: auditLog.entityId }).from(auditLog).where(and(eq(auditLog.action, AVISO.SOBRA), gte(auditLog.createdAt, new Date(now.getTime() - UM_DIA_MS)))),
  ]);
  if (!lideres.length) return { tipo: "lideres", enviados: 0, considerados: 0, dry };

  const { data } = await executeGetComplianceOverview({ actor: { id: "", role: "COORDINATOR", facultyId: null } });
  const avisados = new Set(jaHoje.map((a) => a.id));
  // Turno de dia sem turma da faculdade não é vaga desperdiçada.
  const emTurma = (facultyId: string, d: string) => turmas.some((t) => t.facultyId === facultyId && dia(t.inicio) <= d && dia(t.fim) >= d);

  const envios: Envio[] = [];
  for (const l of lideres) {
    if (!l.facultyId || avisados.has(l.id)) continue;
    const precisam = data.filter((r) => r.facultyId === l.facultyId && GOAL_KINDS.some((k) => r[`missing${k}`] > 0));
    const tiposQueFaltam = new Set(GOAL_KINDS.filter((k) => precisam.some((r) => r[`missing${k}`] > 0)));
    const sobraPorTipo: Partial<Record<GoalKind, number>> = {};
    let vagasDeOutras = 0;
    for (const t of turnos) {
      const k = goalKindOf(t.tipo);
      if (!k) continue;
      if (t.faculty_id === l.facultyId && emTurma(l.facultyId, t.data)) sobraPorTipo[k] = (sobraPorTipo[k] ?? 0) + t.sobra;
      if (t.faculty_id !== l.facultyId && tiposQueFaltam.has(k)) vagasDeOutras += t.abertas;
    }
    const texto = textoSobraParaLider({ faculdade: l.faculdade, sobraPorTipo, internosPrecisando: precisam.length, vagasDeOutras });
    if (!texto) continue;
    envios.push({ para: l.id, texto, action: AVISO.SOBRA, entityId: l.id, payload: { faculdade: l.faculdade, sobraPorTipo, internosPrecisando: precisam.length, vagasDeOutras } });
  }
  await enviar(envios, dry);
  return { tipo: "lideres", enviados: envios.length, considerados: lideres.length, dry, amostra: envios[0]?.texto };
}

// ---------------------------------------------------------------------------

const TROCAS_POR_AVISO = 3;

/**
 * Para cada interno que marcou Quero/Posso num turno com oferta aberta: as
 * ofertas que ele consegue fechar e ainda não recebeu, troca perfeita
 * primeiro. Quem já recebeu aviso de troca hoje fica para amanhã. Puro.
 */
export function trocasParaCadaInterno(
  foto: Pick<FotografiaDoMercado, "ctx" | "ofertas" | "faculdadeDe" | "hoje">,
  jaAvisadas: Map<string, Set<string>>,
  avisadoHoje: Set<string>,
) {
  const { ctx, ofertas, faculdadeDe, hoje } = foto;
  const porTurno = new Map<string, OfertaAberta[]>();
  for (const o of ofertas) {
    const k = `${dia(o.plantao.date)}|${o.plantao.period}`;
    porTurno.set(k, [...(porTurno.get(k) ?? []), o]);
  }
  const saida = new Map<string, { oferta: OfertaAberta; avaliacao: Avaliacao }[]>();
  for (const s of ctx.sinais) {
    if ((s.signal !== "QUERO" && s.signal !== "POSSO") || dia(s.date) < hoje || avisadoHoje.has(s.internId)) continue;
    const doTurno = porTurno.get(`${dia(s.date)}|${s.period}`) ?? [];
    for (const o of doTurno) {
      if (jaAvisadas.get(s.internId)?.has(o.requestId)) continue;
      if (!visivelPara(o, s.internId, faculdadeDe.get(s.internId) ?? new Set())) continue;
      const avaliacao = avaliarOferta(o, s.internId, ctx);
      if (avaliacao.caixa === "FORA") continue;
      saida.set(s.internId, [...(saida.get(s.internId) ?? []), { oferta: o, avaliacao }]);
    }
  }
  for (const [id, lista] of saida) {
    saida.set(id, lista.sort((a, b) => b.avaliacao.forca - a.avaliacao.forca || a.oferta.plantao.date.localeCompare(b.oferta.plantao.date)).slice(0, TROCAS_POR_AVISO));
  }
  return saida;
}

async function avisarTrocas(now: Date, dry: boolean): Promise<ResultadoDosAvisos> {
  const foto = await carregarMercado(now);
  if (!foto.ofertas.length) return { tipo: "trocas", enviados: 0, considerados: 0, dry };
  const interessados = [...new Set(foto.ctx.sinais.filter((s) => s.signal !== "OUTRO_SERVICO").map((s) => s.internId))];
  if (!interessados.length) return { tipo: "trocas", enviados: 0, considerados: foto.ofertas.length, dry };

  const historico = await db.select({ para: auditLog.entityId, payload: auditLog.payload, em: auditLog.createdAt })
    .from(auditLog)
    .where(and(eq(auditLog.action, AVISO.TROCAS), inArray(auditLog.entityId, interessados), gte(auditLog.createdAt, new Date(now.getTime() - 30 * 24 * 60 * 60_000))));
  const jaAvisadas = new Map<string, Set<string>>();
  const avisadoHoje = new Set<string>();
  for (const h of historico) {
    if (!h.para) continue;
    const s = jaAvisadas.get(h.para) ?? new Set<string>();
    for (const id of ((h.payload as { ofertas?: string[] } | null)?.ofertas ?? [])) s.add(id);
    jaAvisadas.set(h.para, s);
    if (now.getTime() - new Date(h.em).getTime() < UM_DIA_MS) avisadoHoje.add(h.para);
  }

  // Cota de CRU só de quem tem oferta de CRU em jogo: medir todo mundo custaria caro.
  const comCru = new Set<string>();
  for (const o of foto.ofertas.filter((x) => x.plantao.baseType === "CENTRAL")) {
    comCru.add(o.plantao.internId);
    for (const s of foto.ctx.sinais) if (`${dia(s.date)}|${s.period}` === `${dia(o.plantao.date)}|${o.plantao.period}`) comCru.add(s.internId);
  }
  for (const id of comCru) if (await findInternOverCruQuota([id], foto.hoje)) foto.ctx.cotaCruUsada.add(id);

  const porInterno = trocasParaCadaInterno(foto, jaAvisadas, avisadoHoje);
  const primeiro = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;
  const envios: Envio[] = [...porInterno].map(([para, lista]) => ({
    para,
    texto: textoTrocasNosTurnosMarcados(lista.map(({ oferta, avaliacao }) => ({
      base: oferta.plantao.baseName.replace(/^Base\s+/i, ""),
      quando: quando(dia(oferta.plantao.date), oferta.plantao.period, oferta.plantao.shift),
      quem: primeiro(oferta.nome),
      perfeita: avaliacao.caixa === "PERFEITA",
      dar: avaliacao.entregar
        ? `${avaliacao.entregar.baseName.replace(/^Base\s+/i, "")}, ${quando(dia(avaliacao.entregar.date), avaliacao.entregar.period, avaliacao.entregar.shift)}`
        : null,
    }))),
    action: AVISO.TROCAS,
    entityId: para,
    payload: { ofertas: lista.map((x) => x.oferta.requestId) },
  }));
  await enviar(envios, dry);
  return { tipo: "trocas", enviados: envios.length, considerados: interessados.length, dry, amostra: envios[0]?.texto };
}

export async function executarAvisosDaDai(tipo: TipoDeAviso, params: { now?: Date; dry?: boolean } = {}): Promise<ResultadoDosAvisos> {
  const now = params.now ?? new Date();
  const dry = params.dry ?? false;
  if (tipo === "plantao") return avisarPlantao(now, dry);
  if (tipo === "vagas") return avisarVagas(now, dry);
  if (tipo === "trocas") return avisarTrocas(now, dry);
  return avisarLideres(now, dry);
}
