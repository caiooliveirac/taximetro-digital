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
 *  - repescagem: vaga livre que segue aberta 8h antes do turno virou extra
 *    (repescagem.ts): vai a quem ainda precisa do tipo e a quem marcou Quero
 *    no turno sem nunca ter tido extra, uma vez por vaga para cada interno,
 *    com "pega direto".
 *  - rodas:   troca a três que fecha com as disponibilidades (quem precisa sair
 *    de um plantão e quem marcou Quero/Posso), para os três ao mesmo tempo.
 *    Uma vez por dia; cada pessoa recebe no máximo uma a cada 2 dias, e a
 *    mesma roda nunca vai duas vezes (swap-cycle-policy.ts).
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
import { assignments, auditLog, bases, cohorts, extraShiftOffers, faculties, userRoles, users } from "@/db/schema";
import { executeGetComplianceOverview } from "@/features/compliance/application/use-cases/get-compliance-overview";
import { AUDIT_CASO_ABERTO } from "@/lib/dai-casos";
import { internDaySignals } from "@/db/schema";
import { comExtraNoHistorico, naRepescagem } from "@/features/extra-offers/application/repescagem";
import { GOAL_KINDS, goalKindOf, type GoalKind } from "@/lib/goal-slots";
import { quando } from "@/lib/luna-inteligencia";
import { addDaysToDateStr, getBrazilNowParts, hasShiftStarted, localDateStr } from "@/lib/utils";
import { horaDoSorteio, textoDaHora, vagasDoTurno } from "@/features/extra-offers/application/sorteio-repescagem";
import { ADIAMENTO_DO_SORTEIO_H, ESPERA_DO_SORTEIO_MIN, horaDoSorteioAdiado, minutosDesdeAbertura, sorteioFeito } from "@/features/extra-offers/application/repescagem";
import { sorteioInscricoes } from "@/db/schema";
import { plantaoSemDescanso, type TurnoDePlantao } from "@/shared/domain/policies/rest-policy";
import { soAsQueCabem } from "@/features/extra-offers/application/lotacao";
import { enviar, type Envio } from "./remetente";
import { listToReplace } from "@/features/scheduling/infra/repositories/commitment-release-repository";
import { aindaDeveRepor, JANELA_LIBERACOES_DIAS } from "@/features/scheduling/domain/policies/commitment-release-policy";
import { temaParaPlantao, textoAnuncioSorteio, textoProximoPlantao, textoRepescagem, textoReposicao, textoRodaSugerida, textoSobraParaLider, textoTrocasNosTurnosMarcados, textoVagasAbertas, type PernaAvisada, type VagaAvisada } from "./textos";
import { encontrarRodas, minhaPerna, problemaNaRoda, type RodaSugerida } from "@/shared/domain/policies/swap-cycle-policy";
import { carregarMercado, type FotografiaDoMercado } from "@/features/requests/application/use-cases/load-swap-market";
import { findInternOverCruQuota } from "@/features/requests/application/use-cases/handle-swap-peer-action";
import { avaliarOferta, visivelPara, type Avaliacao, type OfertaAberta } from "@/shared/domain/policies/swap-match-policy";

export const AVISO = { PLANTAO: "DAI_AVISO_PLANTAO", VAGAS: "DAI_AVISO_VAGAS", SOBRA: "DAI_AVISO_SOBRA", TROCAS: "DAI_AVISO_TROCAS", REPESCAGEM: "DAI_AVISO_REPESCAGEM", RODAS: "DAI_AVISO_RODAS", SOLICITACAO: "DAI_AVISO_SOLICITACAO", SORTEIO: "DAI_AVISO_SORTEIO_ANUNCIO", REPOSICAO: "DAI_AVISO_REPOSICAO" } as const;
export type TipoDeAviso = "plantao" | "vagas" | "lideres" | "trocas" | "repescagem" | "rodas" | "sorteio" | "reposicao";
export type ResultadoDosAvisos = { tipo: TipoDeAviso; enviados: number; considerados: number; dry: boolean; amostra?: string };

export { enviar, type Envio } from "./remetente";

const VAGAS_POR_AVISO = 3;
const JANELA_VAGAS_DIAS = 10;
const JANELA_SOBRA_DIAS = 7;
/** "Hoje" para não repetir: 20h cobre o dia sem depender do fuso do audit_log. */
const UM_DIA_MS = 20 * 60 * 60_000;

const dia = (d: unknown) => String(d).slice(0, 10);

/**
 * Interno perguntou à Dai pelos pedidos sem decisão: ela manda ao líder a lista
 * (já pronta em luna-ferramentas.ts, sem modelo). Não repete em 20h para os
 * mesmos pedidos — quem decide isso é `Fontes.avisoAoLider`, antes de chegar aqui.
 */
export async function avisarLiderDasSolicitacoes(internId: string, aviso: { para: string; ids: string[]; itens: string[] }) {
  const [eu] = await db
    .select({ nome: users.name, faculdade: faculties.abbreviation })
    .from(users)
    .leftJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.isActive, true), inArray(userRoles.role, ["INTERN", "LEADER"])))
    .leftJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .where(eq(users.id, internId))
    .limit(1);
  const n = aviso.itens.length;
  const texto = [
    `Oi! ${eu?.nome ?? "Um interno"}${eu?.faculdade ? ` (${eu.faculdade})` : ""} me perguntou por ${n === 1 ? "uma solicitação que ainda espera" : `${n} solicitações que ainda esperam`} sua decisão:`,
    ...aviso.itens.map((i) => `- ${i}`),
    "Estão em **Solicitações**, no seu menu de líder.",
  ].join("\n");
  await enviar([{ para: aviso.para, texto, action: AVISO.SOLICITACAO, entityId: aviso.ids[0], payload: { de: internId, ids: aviso.ids } }], false);
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
 * recebe as vagas menos citadas até ali. Na repescagem, quem marcou Quero
 * no turno (`quer`, "data|turno") também serve, mesmo de meta fechada: vem
 * por último, urgência zero. Pura, para teste.
 */
export function vagasParaCadaInterno(
  vagas: Vaga[],
  internos: { userId: string; facultyId: string | null; inicio: string | null; fim: string | null; faltam: Record<GoalKind, number>; quer?: Set<string> }[],
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
      (i.faltam[v.tipo] > 0 || Boolean(i.quer?.has(`${v.date}|${v.period}`))) &&
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

/** Vagas livres abertas de `de` a `ate`, que cabem na viatura e cujo turno não começou. */
async function vagasLivresAbertas(de: string, ate: string, now: Date): Promise<Vaga[]> {
  const ofertas = await db
    .select({ id: extraShiftOffers.id, baseCode: bases.code, baseType: bases.type, date: extraShiftOffers.date, period: extraShiftOffers.period, shift: extraShiftOffers.shift, releasedFacultyId: extraShiftOffers.releasedFacultyId, liberadaPor: faculties.abbreviation })
    .from(extraShiftOffers)
    .innerJoin(bases, eq(bases.id, extraShiftOffers.baseId))
    .leftJoin(faculties, eq(faculties.id, extraShiftOffers.releasedFacultyId))
    .where(and(
      or(isNotNull(extraShiftOffers.releasedFacultyId), eq(extraShiftOffers.autoRelease, "SEM_DONO")),
      isNull(extraShiftOffers.claimedBy), isNull(extraShiftOffers.cancelledAt), isNull(extraShiftOffers.reservedBy),
      gte(extraShiftOffers.date, de), lte(extraShiftOffers.date, ate),
    ))
    .orderBy(extraShiftOffers.date, extraShiftOffers.period);
  return soAsQueCabem(ofertas
    .map((o) => ({ ...o, date: dia(o.date), period: o.period as "DAY" | "NIGHT", tipo: goalKindOf(o.baseType) }))
    .filter((o): o is typeof o & { tipo: GoalKind } => Boolean(o.tipo) && !hasShiftStarted(o.date, o.period, o.shift, now)));
}

/** Plantões não cancelados dos internos entre as datas, como turnos para a regra das 12h. */
async function turnosDosInternos(ids: string[], de: string, ate: string) {
  const plantoes = await db.select({ internId: assignments.internId, date: assignments.date, period: assignments.period, shift: assignments.shift, baseCode: bases.code })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .where(and(inArray(assignments.internId, ids), ne(assignments.status, "CANCELLED"), gte(assignments.date, de), lte(assignments.date, ate)));
  const turnosDe = new Map<string, TurnoDePlantao[]>();
  for (const p of plantoes) {
    turnosDe.set(p.internId, [...(turnosDe.get(p.internId) ?? []), { date: dia(p.date), period: p.period as "DAY" | "NIGHT", shift: p.shift, baseCode: p.baseCode }]);
  }
  return turnosDe;
}

async function internosDoCompliance() {
  const { data } = await executeGetComplianceOverview({ actor: { id: "", role: "COORDINATOR", facultyId: null } });
  return data.map((r) => ({
    userId: r.userId,
    facultyId: r.facultyId ?? null,
    inicio: r.rotationStartDate ? dia(r.rotationStartDate) : null,
    fim: r.rotationEndDate ? dia(r.rotationEndDate) : null,
    faltam: { USA: r.missingUSA, CRU: r.missingCRU, CRL: r.missingCRL } as Record<GoalKind, number>,
  }));
}

async function avisarVagas(now: Date, dry: boolean): Promise<ResultadoDosAvisos> {
  const hoje = localDateStr(now);
  const ate = addDaysToDateStr(hoje, JANELA_VAGAS_DIAS - 1);
  // Vaga de hoje não dá tempo de pedir ao líder e ele escalar; a de última
  // hora vai no aviso da repescagem, que diz "pega direto".
  const vagas = (await vagasLivresAbertas(addDaysToDateStr(hoje, 1), ate, now))
    .filter((v) => !naRepescagem(v.date, v.period, v.shift, now));
  if (!vagas.length) return { tipo: "vagas", enviados: 0, considerados: 0, dry };

  const tiposAbertos = new Set(vagas.map((v) => v.tipo));
  const internos = (await internosDoCompliance())
    .filter((i) => GOAL_KINDS.some((k) => tiposAbertos.has(k) && i.faltam[k] > 0));
  if (!internos.length) return { tipo: "vagas", enviados: 0, considerados: vagas.length, dry };

  const ids = internos.map((i) => i.userId);
  const [turnosDe, historico] = await Promise.all([
    turnosDosInternos(ids, addDaysToDateStr(hoje, -1), addDaysToDateStr(ate, 1)),
    db.select({ para: auditLog.entityId, payload: auditLog.payload, em: auditLog.createdAt })
      .from(auditLog)
      .where(and(eq(auditLog.action, AVISO.VAGAS), inArray(auditLog.entityId, ids), gte(auditLog.createdAt, new Date(now.getTime() - 15 * 24 * 60 * 60_000)))),
  ]);
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

/**
 * Vaga livre de última hora (repescagem.ts): as que entraram na janela desde a
 * última rodada. Não segue o limite de uma mensagem por dia do aviso de vagas
 * — é a última chance da vaga —, mas cada vaga vai uma vez só a cada interno.
 */
async function avisarRepescagem(now: Date, dry: boolean): Promise<ResultadoDosAvisos> {
  const hoje = localDateStr(now);
  const amanha = addDaysToDateStr(hoje, 1);
  const vagas = (await vagasLivresAbertas(hoje, amanha, now)).filter((v) => naRepescagem(v.date, v.period, v.shift, now));
  if (!vagas.length) return { tipo: "repescagem", enviados: 0, considerados: 0, dry };

  const tiposAbertos = new Set(vagas.map((v) => v.tipo));
  const turnosAbertos = new Set(vagas.map((v) => `${v.date}|${v.period}`));
  const [todos, sinais] = await Promise.all([
    internosDoCompliance(),
    db.select({ internId: internDaySignals.internId, date: internDaySignals.date, period: internDaySignals.period, signal: internDaySignals.signal, label: internDaySignals.label })
      .from(internDaySignals)
      .where(and(gte(internDaySignals.date, addDaysToDateStr(hoje, -1)), lte(internDaySignals.date, addDaysToDateStr(amanha, 1)))),
  ]);
  const quer = new Map<string, Set<string>>();
  for (const s of sinais) {
    const turno = `${dia(s.date)}|${s.period}`;
    if (s.signal === "QUERO" && turnosAbertos.has(turno)) quer.set(s.internId, (quer.get(s.internId) ?? new Set()).add(turno));
  }
  // Quero de quem já teve extra não conta: a vaga como extra é de quem ainda não teve.
  const jaTeveExtra = await comExtraNoHistorico([...quer.keys()]);
  const internos = todos
    .map((i) => ({ ...i, quer: jaTeveExtra.has(i.userId) ? undefined : quer.get(i.userId) }))
    .filter((i) => i.quer || GOAL_KINDS.some((k) => tiposAbertos.has(k) && i.faltam[k] > 0));
  if (!internos.length) return { tipo: "repescagem", enviados: 0, considerados: vagas.length, dry };

  const ids = internos.map((i) => i.userId);
  const [turnosDe, historico] = await Promise.all([
    turnosDosInternos(ids, addDaysToDateStr(hoje, -1), addDaysToDateStr(amanha, 1)),
    db.select({ para: auditLog.entityId, payload: auditLog.payload })
      .from(auditLog)
      .where(and(eq(auditLog.action, AVISO.REPESCAGEM), inArray(auditLog.entityId, ids), gte(auditLog.createdAt, new Date(now.getTime() - 3 * 24 * 60 * 60_000)))),
  ]);
  // Outro serviço (plantão fora do SAMU) também pede 12h de descanso.
  const idsSet = new Set(ids);
  for (const s of sinais) {
    if (s.signal !== "OUTRO_SERVICO" || !idsSet.has(s.internId)) continue;
    turnosDe.set(s.internId, [...(turnosDe.get(s.internId) ?? []), { date: dia(s.date), period: s.period as "DAY" | "NIGHT", shift: null, baseCode: s.label ?? "outro serviço" }]);
  }
  const jaAvisadas = new Map<string, Set<string>>();
  for (const h of historico) {
    if (!h.para) continue;
    const s = jaAvisadas.get(h.para) ?? new Set<string>();
    for (const id of ((h.payload as { ofertas?: string[] } | null)?.ofertas ?? [])) s.add(id);
    jaAvisadas.set(h.para, s);
  }

  const porInterno = vagasParaCadaInterno(vagas, internos, turnosDe, jaAvisadas, hoje);
  const envios: Envio[] = [...porInterno].map(([para, lista]) => ({
    para,
    texto: textoRepescagem(lista.map((v): VagaAvisada => ({ baseCode: v.baseCode, quando: quando(v.date, v.period, v.shift), tipo: v.tipo, liberadaPor: v.liberadaPor }))),
    action: AVISO.REPESCAGEM,
    entityId: para,
    payload: { ofertas: lista.map((v) => v.id) },
  }));
  await enviar(envios, dry);
  return { tipo: "repescagem", enviados: envios.length, considerados: internos.length, dry, amostra: envios[0]?.texto };
}

// ---------------------------------------------------------------------------

/** Antecedência do anúncio: o das 11h sai às 8h15, o das 20h às 15h15. */
const ANUNCIO_HORAS_ANTES = 5;

/**
 * Sorteio da repescagem chegando: avisa quem tem casinha vazia no tipo de
 * alguma vaga (e não é da faculdade que liberou) e quem marcou Quero no
 * turno. Quem já se inscreveu não recebe; ninguém recebe duas vezes o mesmo turno.
 */
async function anunciarSorteios(now: Date, dry: boolean): Promise<ResultadoDosAvisos> {
  const hoje = localDateStr(now);
  const p = getBrazilNowParts(now);
  const agora = p.hour + p.minute / 60;
  // Antes da abertura: o anúncio normal. Passada a abertura sem sorteio
  // (ninguém inscrito): o adiamento, para a hora adiada.
  const turnos = (["DAY", "NIGHT"] as const)
    .flatMap((period) => [hoje, addDaysToDateStr(hoje, 1)].map((date) => {
      const m = minutosDesdeAbertura(date, period, now);
      const adiado = m !== null && m < ADIAMENTO_DO_SORTEIO_H * 60;
      return { date, period, m, adiado, hora: adiado ? horaDoSorteioAdiado(date, period) : horaDoSorteio(date, period) };
    }))
    .filter((t) => !hasShiftStarted(t.date, t.period, null, now) && (t.adiado || (t.m === null && t.hora.date === hoje && t.hora.hour > agora && t.hora.hour - agora <= ANUNCIO_HORAS_ANTES)));
  const envios: Envio[] = [];
  let considerados = 0;
  for (const t of turnos) {
    if (await sorteioFeito(t.date, t.period)) continue;
    const vagas = (await vagasDoTurno(t.date, t.date)).filter((v) => v.period === t.period);
    if (!vagas.length) continue;
    const chave = `${t.date}|${t.period}${t.adiado ? "|adiado" : ""}`;
    const [todos, sinais, inscritos, jaAvisados] = await Promise.all([
      internosDoCompliance(),
      db.select({ internId: internDaySignals.internId }).from(internDaySignals)
        .where(and(eq(internDaySignals.date, t.date), eq(internDaySignals.period, t.period), eq(internDaySignals.signal, "QUERO"))),
      db.select({ internId: sorteioInscricoes.internId }).from(sorteioInscricoes).where(and(eq(sorteioInscricoes.date, t.date), eq(sorteioInscricoes.period, t.period))),
      db.select({ para: auditLog.entityId }).from(auditLog)
        .where(and(eq(auditLog.action, AVISO.SORTEIO), sql`${auditLog.payload}->>'turno' = ${chave}`, gte(auditLog.createdAt, new Date(now.getTime() - 2 * UM_DIA_MS)))),
    ]);
    // Com inscrito na hora o sorteio está rodando: não é adiamento.
    if (t.adiado && inscritos.length && t.m! < ESPERA_DO_SORTEIO_MIN) continue;
    const quer = new Set(sinais.map((s) => s.internId));
    const fora = new Set([...inscritos.map((i) => i.internId), ...jaAvisados.map((a) => a.para).filter((x): x is string => Boolean(x))]);
    const porTipo = new Map<GoalKind, number>();
    for (const v of vagas) porTipo.set(v.tipo!, (porTipo.get(v.tipo!) ?? 0) + 1);
    const candidatos = todos.filter((i) => !fora.has(i.userId) && (quer.has(i.userId) || vagas.some((v) => v.tipo && i.faltam[v.tipo] > 0 && v.releasedFacultyId !== i.facultyId)));
    considerados += candidatos.length;
    if (!candidatos.length) continue;
    // Descanso: quem não cabe em nenhuma vaga do turno não é chamado.
    const turnosDe = await turnosDosInternos(candidatos.map((c) => c.userId), addDaysToDateStr(t.date, -1), addDaysToDateStr(t.date, 1));
    for (const c of candidatos) {
      const meus = turnosDe.get(c.userId) ?? [];
      const cabem = vagas.filter((v) => v.releasedFacultyId !== c.facultyId && !plantaoSemDescanso({ date: v.date, period: v.period, shift: v.shift, baseCode: v.baseCode }, meus));
      if (!cabem.length) continue;
      envios.push({
        para: c.userId,
        texto: textoAnuncioSorteio({
          turno: quando(t.date, t.period),
          hora: textoDaHora(t.hora, hoje),
          vagas: GOAL_KINDS.filter((k) => porTipo.get(k)).map((k) => ({ tipo: k, n: porTipo.get(k)! })),
          precisa: GOAL_KINDS.filter((k) => porTipo.get(k) && c.faltam[k] > 0),
          adiado: t.adiado,
        }),
        action: AVISO.SORTEIO,
        entityId: c.userId,
        payload: { turno: chave },
      });
    }
  }
  await enviar(envios, dry);
  return { tipo: "sorteio", enviados: envios.length, considerados, dry, amostra: envios[0]?.texto };
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

/**
 * Reposição: quem perdeu plantão por compromisso da turma e foi marcado
 * "repor" na aba Liberações, enquanto faltar plantão daquele tipo na meta.
 * Uma vez por dia por interno.
 */
async function avisarReposicao(now: Date, dry: boolean): Promise<ResultadoDosAvisos> {
  const hoje = localDateStr(now);
  const [marcados, jaHoje] = await Promise.all([
    listToReplace({ from: addDaysToDateStr(hoje, -JANELA_LIBERACOES_DIAS) }),
    db.select({ id: auditLog.entityId }).from(auditLog).where(and(eq(auditLog.action, AVISO.REPOSICAO), gte(auditLog.createdAt, new Date(now.getTime() - UM_DIA_MS)))),
  ]);
  if (!marcados.length) return { tipo: "reposicao", enviados: 0, considerados: 0, dry };

  const { data } = await executeGetComplianceOverview({ actor: { id: "", role: "COORDINATOR", facultyId: null } });
  const avisados = new Set(jaHoje.map((a) => a.id));
  const porInterno = new Map<string, typeof marcados>();
  for (const m of marcados) porInterno.set(m.internId, [...(porInterno.get(m.internId) ?? []), m]);

  const envios: Envio[] = [];
  for (const [internId, perdidos] of porInterno) {
    if (avisados.has(internId)) continue;
    const r = data.find((x) => x.userId === internId);
    if (!r) continue; // fora de turma ativa
    const faltam = Object.fromEntries(GOAL_KINDS.map((k) => [k, r[`missing${k}`]])) as Record<GoalKind, number>;
    const devidos = perdidos.filter((p) => aindaDeveRepor({ resolution: "REPOR", baseType: p.baseType }, faltam));
    if (!devidos.length) continue;
    const tipos = [...new Set(devidos.map((p) => goalKindOf(p.baseType)).filter((k): k is GoalKind => Boolean(k)))];
    const texto = textoReposicao({
      perdidos: devidos.map((p) => ({ quando: quando(dia(p.date), p.period as "DAY" | "NIGHT"), baseCode: p.baseCode, titulo: p.title })),
      faltam: tipos.map((tipo) => ({ tipo, n: faltam[tipo] })),
    });
    envios.push({ para: internId, texto, action: AVISO.REPOSICAO, entityId: internId, payload: { perdidos: devidos.length, faltam } });
  }
  await enviar(envios, dry);
  return { tipo: "reposicao", enviados: envios.length, considerados: porInterno.size, dry, amostra: envios[0]?.texto };
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

const RODA_INTERVALO_MS = 2 * 24 * 60 * 60_000;

/**
 * Quais rodas avisar agora: nunca a mesma duas vezes, ninguém em duas rodas
 * na mesma rodada, e quem recebeu aviso de roda há menos de 2 dias fica de
 * fora — a roda só vai se os três puderem receber juntos. Puro.
 */
export function rodasParaAvisar(rodas: RodaSugerida[], jaAvisadas: Set<string>, recentes: Set<string>): RodaSugerida[] {
  const usados = new Set<string>();
  const escolhidas: RodaSugerida[] = [];
  for (const r of rodas) {
    if (jaAvisadas.has(r.assinatura)) continue;
    if (r.pernas.some((p) => usados.has(p.internId) || recentes.has(p.internId))) continue;
    for (const p of r.pernas) usados.add(p.internId);
    escolhidas.push(r);
  }
  return escolhidas;
}

async function avisarRodas(now: Date, dry: boolean): Promise<ResultadoDosAvisos> {
  const foto = await carregarMercado(now);
  let rodas = encontrarRodas(foto.ctx, foto.ofertas);
  if (!rodas.length) return { tipo: "rodas", enviados: 0, considerados: 0, dry };

  // Cota de CRU só dos que estão em roda de CRU.
  const ofertados = new Set(foto.ofertas.map((o) => o.plantao.id));
  for (const r of rodas.filter((x) => x.pernas[0].entrega.baseType === "CENTRAL")) {
    for (const p of r.pernas) if (!foto.ctx.cotaCruUsada.has(p.internId) && await findInternOverCruQuota([p.internId], foto.hoje)) foto.ctx.cotaCruUsada.add(p.internId);
  }
  rodas = rodas.filter((r) => !problemaNaRoda(r.pernas, foto.ctx, new Set(r.pernas.map((p) => p.entrega.id).filter((id) => ofertados.has(id)))));

  const historico = await db.select({ para: auditLog.entityId, payload: auditLog.payload, em: auditLog.createdAt })
    .from(auditLog)
    .where(and(eq(auditLog.action, AVISO.RODAS), gte(auditLog.createdAt, new Date(now.getTime() - 60 * 24 * 60 * 60_000))));
  const jaAvisadas = new Set<string>();
  const recentes = new Set<string>();
  for (const h of historico) {
    const assinatura = (h.payload as { assinatura?: string } | null)?.assinatura;
    if (assinatura) jaAvisadas.add(assinatura);
    if (h.para && now.getTime() - new Date(h.em).getTime() < RODA_INTERVALO_MS) recentes.add(h.para);
  }

  const primeiro = (id: string) => (foto.ctx.nomes.get(id) ?? "Um colega").trim().split(/\s+/)[0];
  const curto = (p: { baseName: string; date: string; period: string; shift: string | null }) =>
    `${p.baseName.replace(/^Base\s+/i, "")}, ${quando(dia(p.date), p.period, p.shift)}`;
  const envios: Envio[] = [];
  for (const r of rodasParaAvisar(rodas, jaAvisadas, recentes)) {
    const pernas: PernaAvisada[] = r.pernas.map((p, i) => ({
      quem: primeiro(p.internId),
      entrega: curto(p.entrega),
      recebe: curto(p.recebe),
      deQuem: primeiro(r.pernas[(i + 2) % 3].internId),
      paraQuem: primeiro(r.pernas[(i + 1) % 3].internId),
    }));
    r.pernas.forEach((p, i) => {
      envios.push({
        para: p.internId,
        texto: textoRodaSugerida({ ...pernas[i], pediu: minhaPerna(r, p.internId, foto.ctx)?.pediu ?? false }, pernas.filter((_, j) => j !== i)),
        action: AVISO.RODAS,
        entityId: p.internId,
        payload: { assinatura: r.assinatura, sinalizadas: r.sinalizadas },
      });
    });
  }
  await enviar(envios, dry);
  return { tipo: "rodas", enviados: envios.length, considerados: rodas.length, dry, amostra: envios[0]?.texto };
}

export async function executarAvisosDaDai(tipo: TipoDeAviso, params: { now?: Date; dry?: boolean } = {}): Promise<ResultadoDosAvisos> {
  const now = params.now ?? new Date();
  const dry = params.dry ?? false;
  if (tipo === "plantao") return avisarPlantao(now, dry);
  if (tipo === "vagas") return avisarVagas(now, dry);
  if (tipo === "trocas") return avisarTrocas(now, dry);
  if (tipo === "repescagem") return avisarRepescagem(now, dry);
  if (tipo === "rodas") return avisarRodas(now, dry);
  if (tipo === "sorteio") return anunciarSorteios(now, dry);
  if (tipo === "reposicao") return avisarReposicao(now, dry);
  return avisarLideres(now, dry);
}
