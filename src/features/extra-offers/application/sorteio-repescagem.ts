/**
 * Sorteio da repescagem. Vaga livre que segue aberta na abertura da
 * repescagem (repescagem.ts: 20h da véspera no diurno, 11h no noturno) não
 * vai mais para quem clicar primeiro: quem quer o turno se inscreve antes, e
 * na hora o sistema distribui.
 *
 * Ordem, por vaga (o critério depende do tipo dela):
 *  1. meta abaixo: casinha vazia no tipo — conta na meta;
 *  2. meta completa e nenhum extra até agora — entra como extra;
 *  3. já teve extra — entra como extra, só com o que sobrar.
 * Dentro do critério, a ordem sorteada: sha256(semente + id), semente
 * pública — com quem deve reposição (plantão perdido por compromisso da
 * turma, marcado "repor" na aba Liberações) à frente dos demais. Um lugar por pessoa. O que valida cada lugar (descanso, viatura,
 * meta/extra, mesmo turno) é o mesmo claim da repescagem
 * (claim-extra-offer.ts), com a Dai no papel da coordenação.
 *
 * Inscritos e resultado são públicos (/api/intern/sorteios). Só entre
 * interessados: sem inscrito na abertura, o sorteio espera 2h e a Dai anuncia
 * de novo. Até ele rodar, ninguém pega a vaga direto; depois, o que sobrou
 * volta ao "primeiro que pegar".
 */

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { bases, extraShiftOffers, faculties, sorteioInscricoes, sorteios, userRoles, users } from "@/db/schema";
import { executeGetComplianceOverview } from "@/features/compliance/application/use-cases/get-compliance-overview";
import { enviar, idDaDai, type Envio } from "@/features/dai-avisos/remetente";
import { GOAL_KINDS, goalKindOf, type GoalKind } from "@/lib/goal-slots";
import { quando } from "@/lib/luna-inteligencia";
import { addDaysToDateStr, hasShiftStarted, localDateStr, type ShiftPeriod } from "@/lib/utils";
import { soAsQueCabem } from "./lotacao";
import { ADIAMENTO_DO_SORTEIO_H, ESPERA_DO_SORTEIO_MIN, aberturaDaRepescagem, comExtraNoHistorico, horaDoSorteioAdiado, minutosDesdeAbertura, sorteioFeito } from "./repescagem";
import { executeClaimExtraOffer } from "./use-cases/claim-extra-offer";
import { liberarParaRepescagem } from "@/features/scheduling/application/use-cases/auto-release-slots";
import { listToReplace } from "@/features/scheduling/infra/repositories/commitment-release-repository";
import { aindaDeveRepor, JANELA_LIBERACOES_DIAS, ordemComReposicao } from "@/features/scheduling/domain/policies/commitment-release-policy";

export const AVISO_SORTEIO = "DAI_AVISO_SORTEIO";
const PERIODOS: ShiftPeriod[] = ["DAY", "NIGHT"];
/** Quantos dias à frente a tela mostra sorteios abertos à inscrição. */
const DIAS_A_FRENTE = 3;

export type Prioridade = 1 | 2 | 3;
export const ROTULO_PRIORIDADE: Record<Prioridade, string> = { 1: "meta abaixo no tipo", 2: "nunca teve extra", 3: "já teve extra" };

export type Candidato = { internId: string; facultyId: string | null; faltam: Record<GoalKind, number>; jaTeveExtra: boolean };
export type VagaDoSorteio = { offerId: string; baseCode: string; tipo: GoalKind | null; releasedFacultyId: string | null };

export function prioridadeNoTipo(c: Pick<Candidato, "faltam" | "jaTeveExtra">, tipo: GoalKind | null): Prioridade {
  if (tipo && c.faltam[tipo] > 0) return 1;
  return c.jaTeveExtra ? 3 : 2;
}

/** A ordem sorteada: qualquer um refaz com a semente publicada. */
export function ordemDoSorteio(semente: string, ids: string[]): string[] {
  const h = (id: string) => createHash("sha256").update(`${semente}:${id}`).digest("hex");
  return [...ids].sort((a, b) => h(a).localeCompare(h(b)));
}

/**
 * Critério 1 inteiro antes do 2, o 2 antes do 3; dentro dele, a ordem
 * sorteada. A faculdade que liberou a vaga não a pega. `tentar` grava o
 * plantão e devolve null, ou o motivo de não caber.
 */
export async function distribuir(
  ordem: Candidato[],
  vagas: VagaDoSorteio[],
  tentar: (c: Candidato, v: VagaDoSorteio) => Promise<string | null>,
) {
  const levou = new Map<string, { vaga: VagaDoSorteio; prioridade: Prioridade }>();
  const motivos = new Map<string, string>();
  const livres = [...vagas];
  for (const p of [1, 2, 3] as const) {
    for (const c of ordem) {
      if (levou.has(c.internId)) continue;
      for (const v of livres.filter((x) => x.releasedFacultyId !== c.facultyId && prioridadeNoTipo(c, x.tipo) === p)) {
        const erro = await tentar(c, v);
        if (erro === null) {
          levou.set(c.internId, { vaga: v, prioridade: p });
          livres.splice(livres.indexOf(v), 1);
          break;
        }
        motivos.set(c.internId, erro);
      }
    }
  }
  return { levou, motivos };
}

/**
 * Roda agora? Na abertura (até a folga do cron), só se já houver inscrito;
 * sem ninguém, espera a hora adiada e então roda com quem houver.
 */
export function deveSortear(minutosDesdeAbertura: number, inscritos: number): boolean {
  if (minutosDesdeAbertura >= ADIAMENTO_DO_SORTEIO_H * 60) return true;
  return minutosDesdeAbertura < ESPERA_DO_SORTEIO_MIN && inscritos > 0;
}

// ---------------------------------------------------------------------------
// Banco

const dia = (d: unknown) => String(d).slice(0, 10);

/** Hora do sorteio do turno = abertura da repescagem (o turno da tarde da EBMSP cai na mesma das 20h). */
export const horaDoSorteio = (date: string, period: ShiftPeriod) => aberturaDaRepescagem(date, period, null);

export function textoDaHora(h: { date: string; hour: number }, hoje: string) {
  const d = h.date === hoje ? "hoje" : h.date === addDaysToDateStr(hoje, 1) ? "amanhã" : quando(h.date, "DAY").replace(/ dia$/, "");
  return `${d} às ${h.hour}h`;
}

/** CRU não vai a sorteio: só muda de mãos por troca (decisão do Caio, 30/10). */
export const entraNoSorteio = (tipo: GoalKind | null) => tipo !== "CRU";

/** Vagas livres abertas no turno que cabem na viatura — as que vão a sorteio. */
export async function vagasDoTurno(de: string, ate: string) {
  const ofertas = await db
    .select({ id: extraShiftOffers.id, baseCode: bases.code, baseType: bases.type, date: extraShiftOffers.date, period: extraShiftOffers.period, shift: extraShiftOffers.shift, releasedFacultyId: extraShiftOffers.releasedFacultyId, autoRelease: extraShiftOffers.autoRelease, liberadaPor: faculties.abbreviation })
    .from(extraShiftOffers)
    .innerJoin(bases, eq(bases.id, extraShiftOffers.baseId))
    .leftJoin(faculties, eq(faculties.id, extraShiftOffers.releasedFacultyId))
    .where(and(
      or(isNotNull(extraShiftOffers.releasedFacultyId), eq(extraShiftOffers.autoRelease, "SEM_DONO")),
      isNull(extraShiftOffers.claimedBy), isNull(extraShiftOffers.cancelledAt), isNull(extraShiftOffers.reservedBy),
      gte(extraShiftOffers.date, de), lte(extraShiftOffers.date, ate),
    ));
  return soAsQueCabem(ofertas
    .map((o) => ({ ...o, date: dia(o.date), period: o.period as ShiftPeriod, tipo: goalKindOf(o.baseType) }))
    .filter((o) => entraNoSorteio(o.tipo)));
}

/** Inscritos com nome e faculdade (vínculo ativo de interno ou líder). */
async function inscritosDe(date: string, period: ShiftPeriod) {
  const rows = await db
    .select({ internId: sorteioInscricoes.internId, nome: users.name, facultyId: userRoles.facultyId, faculdade: faculties.abbreviation, em: sorteioInscricoes.createdAt })
    .from(sorteioInscricoes)
    .innerJoin(users, eq(users.id, sorteioInscricoes.internId))
    .leftJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.isActive, true), inArray(userRoles.role, ["INTERN", "LEADER"])))
    .leftJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .where(and(eq(sorteioInscricoes.date, date), eq(sorteioInscricoes.period, period)))
    .orderBy(sorteioInscricoes.createdAt);
  // Um vínculo por pessoa basta para a faculdade.
  return [...new Map(rows.map((r) => [r.internId, r])).values()];
}

export type LinhaDoResultado = {
  posicao: number;
  internId: string;
  nome: string;
  faculdade: string | null;
  prioridade: Prioridade | null;
  levou: { offerId: string; baseCode: string; tipo: GoalKind | null } | null;
  motivo?: string;
};

function textoDoResultado(l: LinhaDoResultado, turno: string, n: { vagas: number; inscritos: number }, sobrou: number) {
  if (!n.vagas) return `O sorteio de ${turno} não teve vaga: as que estavam livres foram escaladas antes da hora (pelo líder ou pela coordenação).`;
  if (l.levou) {
    return [
      `Você levou no sorteio da repescagem: **${l.levou.baseCode} ${turno}** (${l.levou.tipo ?? "?"}).`,
      l.prioridade === 1 ? "Conta na sua meta." : "Entra como extra (não conta na meta).",
      "Já está na sua escala.",
    ].join(" ");
  }
  return [
    `Não foi desta vez no sorteio de ${turno}: ${n.vagas} ${n.vagas === 1 ? "vaga" : "vagas"} para ${n.inscritos} ${n.inscritos === 1 ? "inscrito" : "inscritos"}, e você ficou em ${l.posicao}º na ordem sorteada.`,
    l.motivo ? `Na vaga que chegou a você: ${l.motivo}` : "",
    sobrou ? `Sobrou ${sobrou} ${sobrou === 1 ? "vaga que ninguém" : "vagas que ninguém"} do sorteio pôde levar: agora é quem pegar primeiro, na aba Extras.` : "",
    "O resultado completo está em Extras → Sorteios.",
  ].filter(Boolean).join(" ");
}

/**
 * Roda os sorteios cuja hora chegou (cron de hora em hora, no minuto 0: as
 * aberturas são às 11h e às 20h). A linha em `sorteios` entra antes dos
 * claims e trava o turno: duas execuções não sorteiam o mesmo.
 */
export async function executarSorteios(params: { now?: Date; dry?: boolean } = {}) {
  const now = params.now ?? new Date();
  const dry = params.dry ?? false;
  const hoje = localDateStr(now);
  const feitos: { turno: string; vagas: number; inscritos: number; levaram: number }[] = [];

  for (const date of [hoje, addDaysToDateStr(hoje, 1)]) {
    for (const period of PERIODOS) {
      const m = minutosDesdeAbertura(date, period, now);
      if (m === null || hasShiftStarted(date, period, null, now)) continue;
      if (await sorteioFeito(date, period)) continue;
      // Lugar de USA da grade ainda vazio vira vaga livre agora (prazo e desfeita não seguram).
      await liberarParaRepescagem({ date, period, now, dryRun: dry });
      // Ninguém inscrito na hora: adiado (a Dai anuncia de novo, avisos.ts).
      if (!deveSortear(m, (await inscritosDe(date, period)).length)) continue;

      const semente = randomBytes(16).toString("hex");
      if (!dry) {
        const [linha] = await db.insert(sorteios).values({ date, period, semente, resultado: [] }).onConflictDoNothing().returning({ id: sorteios.id });
        if (!linha) continue;
      }

      const [vagas, inscritos] = await Promise.all([
        vagasDoTurno(date, date).then((v) => v.filter((x) => x.period === period && !hasShiftStarted(x.date, x.period, x.shift, now))),
        inscritosDe(date, period),
      ]);
      const ids = inscritos.map((i) => i.internId);
      const [{ data: metas }, jaTeveExtra, dai] = await Promise.all([
        ids.length ? executeGetComplianceOverview({ actor: { id: "", role: "COORDINATOR", facultyId: null } }) : Promise.resolve({ data: [] as Awaited<ReturnType<typeof executeGetComplianceOverview>>["data"] }),
        comExtraNoHistorico(ids),
        idDaDai({ criar: !dry }),
      ]);
      const faltamDe = (id: string) => {
        const r = metas.find((m) => m.userId === id);
        return { USA: r?.missingUSA ?? 0, CRU: r?.missingCRU ?? 0, CRL: r?.missingCRL ?? 0 } as Record<GoalKind, number>;
      };
      const porId = new Map(inscritos.map((i) => [i.internId, i]));
      const sorteada: Candidato[] = ordemDoSorteio(semente, ids).map((id) => ({
        internId: id, facultyId: porId.get(id)!.facultyId ?? null, faltam: faltamDe(id), jaTeveExtra: jaTeveExtra.has(id),
      }));
      // Quem deve reposição de plantão perdido por compromisso da turma
      // (aba Liberações) vai à frente dentro de cada critério.
      const devem = new Set((ids.length ? await listToReplace({ internIds: ids, from: addDaysToDateStr(hoje, -JANELA_LIBERACOES_DIAS) }) : [])
        .filter((r) => aindaDeveRepor({ resolution: "REPOR", baseType: r.baseType }, faltamDe(r.internId)))
        .map((r) => r.internId));
      const ordem = ordemComReposicao(sorteada, devem);

      const { levou, motivos } = await distribuir(
        ordem,
        // Lugar da grade levado à repescagem é da faculdade dona: ela concorre também.
        vagas.map((v) => ({ offerId: v.id, baseCode: v.baseCode, tipo: v.tipo, releasedFacultyId: v.autoRelease === "REPESCAGEM" ? null : v.releasedFacultyId })),
        async (c, v) => {
          if (dry) return null;
          if (!c.facultyId || !dai) return "sem faculdade ativa no cadastro";
          const r = await executeClaimExtraOffer({ actor: { id: dai, role: "COORDINATOR", facultyId: null }, offerId: v.offerId, internId: c.internId, facultyId: c.facultyId });
          return r.status === 200 ? null : String((r.body as { error?: string }).error ?? "não coube");
        },
      );

      const resultado: LinhaDoResultado[] = ordem.map((c, i) => {
        const l = levou.get(c.internId);
        const melhor = vagas.length ? (Math.min(...vagas.map((v) => prioridadeNoTipo(c, v.tipo))) as Prioridade) : null;
        return {
          posicao: i + 1,
          internId: c.internId,
          nome: porId.get(c.internId)!.nome,
          faculdade: porId.get(c.internId)!.faculdade ?? null,
          prioridade: l?.prioridade ?? melhor,
          levou: l ? { offerId: l.vaga.offerId, baseCode: l.vaga.baseCode, tipo: l.vaga.tipo } : null,
          ...(l || !motivos.get(c.internId) ? {} : { motivo: motivos.get(c.internId) }),
        };
      });
      const turno = quando(date, period);
      const sobrou = vagas.length - levou.size;
      const envios: Envio[] = resultado.map((l) => ({
        para: l.internId,
        texto: textoDoResultado(l, turno, { vagas: vagas.length, inscritos: ids.length }, sobrou),
        action: AVISO_SORTEIO,
        entityId: l.internId,
        payload: { date, period, levou: l.levou?.offerId ?? null, posicao: l.posicao },
      }));
      if (!dry) {
        await db.update(sorteios).set({ resultado }).where(and(eq(sorteios.date, date), eq(sorteios.period, period)));
        await enviar(envios, false);
      }
      feitos.push({ turno, vagas: vagas.length, inscritos: ids.length, levaram: levou.size });
    }
  }
  return feitos;
}

// ---------------------------------------------------------------------------
// O que a tela mostra (público para internos e líderes)

export async function painelDosSorteios(eu: string, now: Date = new Date()) {
  const hoje = localDateStr(now);
  const ate = addDaysToDateStr(hoje, DIAS_A_FRENTE);
  const [vagas, feitos] = await Promise.all([
    vagasDoTurno(hoje, ate),
    db.select().from(sorteios).where(gte(sorteios.date, addDaysToDateStr(hoje, -1))).orderBy(desc(sorteios.date), desc(sorteios.period)),
  ]);
  const jaFeito = new Set(feitos.map((s) => `${dia(s.date)}|${s.period}`));

  const proximos = [];
  for (let d = hoje; d <= ate; d = addDaysToDateStr(d, 1)) {
    for (const period of PERIODOS) {
      if (jaFeito.has(`${d}|${period}`) || hasShiftStarted(d, period, null, now)) continue;
      const doTurno = vagas.filter((v) => v.date === d && v.period === period);
      const inscritos = await inscritosDe(d, period);
      if (!doTurno.length && !inscritos.length) continue;
      const porTipo: Partial<Record<GoalKind, number>> = {};
      for (const v of doTurno) if (v.tipo) porTipo[v.tipo] = (porTipo[v.tipo] ?? 0) + 1;
      // Sem inscrito na abertura, o sorteio foi adiado; com inscrito, está rodando.
      const m = minutosDesdeAbertura(d, period, now);
      const adiado = m !== null && m < ADIAMENTO_DO_SORTEIO_H * 60 && !(inscritos.length && m < ESPERA_DO_SORTEIO_MIN);
      const hora = adiado ? horaDoSorteioAdiado(d, period) : horaDoSorteio(d, period);
      proximos.push({
        date: d,
        period,
        turno: quando(d, period),
        hora: textoDaHora(hora, hoje),
        // Passou da hora e o cron ainda não rodou: alguns minutos.
        sorteando: m !== null && !adiado,
        adiado,
        vagas: GOAL_KINDS.filter((k) => porTipo[k]).map((k) => ({ tipo: k, n: porTipo[k]! })),
        inscritos: inscritos.map((i) => ({ nome: i.nome, faculdade: i.faculdade ?? null, eu: i.internId === eu })),
        inscrito: inscritos.some((i) => i.internId === eu),
      });
    }
  }

  const resultados = feitos.map((s) => {
    const linhas = (s.resultado as LinhaDoResultado[]) ?? [];
    return {
      turno: quando(dia(s.date), s.period),
      semente: s.semente,
      linhas: linhas.map((l) => ({ posicao: l.posicao, nome: l.nome, faculdade: l.faculdade, prioridade: l.prioridade ? ROTULO_PRIORIDADE[l.prioridade] : null, levou: l.levou?.baseCode ?? null, eu: l.internId === eu })),
    };
  }).filter((r) => r.linhas.length);

  return { proximos, resultados };
}

/** Inscrição aberta até o sorteio rodar: antes da abertura e, se adiado, até a hora adiada. */
function inscricaoAberta(date: string, period: ShiftPeriod, now: Date) {
  if (hasShiftStarted(date, period, null, now)) return false;
  const m = minutosDesdeAbertura(date, period, now);
  return m === null || m < ADIAMENTO_DO_SORTEIO_H * 60;
}

/** Inscrição aberta até a hora do sorteio. */
export async function inscrever(internId: string, date: string, period: ShiftPeriod, now: Date = new Date()) {
  if (date < localDateStr(now) || !inscricaoAberta(date, period, now) || (await sorteioFeito(date, period))) {
    return { ok: false as const, erro: "A inscrição deste turno já fechou: o sorteio é na abertura da repescagem." };
  }
  await db.insert(sorteioInscricoes).values({ internId, date, period }).onConflictDoNothing();
  return { ok: true as const };
}

export async function desistir(internId: string, date: string, period: ShiftPeriod, now: Date = new Date()) {
  if (!inscricaoAberta(date, period, now) || (await sorteioFeito(date, period))) {
    return { ok: false as const, erro: "O sorteio deste turno já começou." };
  }
  await db.delete(sorteioInscricoes).where(and(eq(sorteioInscricoes.internId, internId), eq(sorteioInscricoes.date, date), eq(sorteioInscricoes.period, period)));
  return { ok: true as const };
}
