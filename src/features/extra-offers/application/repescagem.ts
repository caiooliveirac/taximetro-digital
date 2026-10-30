/**
 * Repescagem: vaga livre (liberada por faculdade ou sem dono) que continua
 * aberta 8h antes do início do turno vira extra, sem o líder e sem a trava da
 * meta. Na abertura ela vai a sorteio entre os inscritos (sorteio-repescagem.ts);
 * o que sobrar, quem chegar primeiro leva. Até ali o caminho pelo líder é o
 * certo; depois dele não dá mais tempo.
 *
 * Abertura fora de 8h–20h recua para as 20h anteriores, que é a última
 * rodada do aviso da Dai e ninguém recebe mensagem de madrugada: noturno
 * (19h) abre às 11h do dia, diurno (7h) e tarde da EBMSP (13h) às 20h da
 * véspera. Fecha quando o turno começa (hasShiftStarted).
 *
 * Continua valendo: 12h de descanso, lugar na viatura (lotacao.ts) e a
 * faculdade que liberou não pega. Quem ainda tem casinha vazia no tipo ganha
 * plantão da meta; quem já fechou, plantão extra (não conta na meta) — mas só
 * se nunca teve extra: quem já tem um no histórico não leva outro só por ter
 * visto primeiro.
 *
 * Nada muda no banco: a janela sai do horário. A regra é pura, para teste;
 * vagasNaRepescagem, no fim, é a leitura que a aba Extras e a Dai usam.
 */

import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { assignments, sorteios } from "@/db/schema";
import { listFreeOffers } from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import { goalKindOf } from "@/lib/goal-slots";
import { addDaysToDateStr, getBrazilNowParts, hasShiftStarted, localDateStr, type ShiftPeriod } from "@/lib/utils";
import { soAsQueCabem } from "./lotacao";

export const HORAS_ANTES_DA_REPESCAGEM = 8;
const PRIMEIRA_HORA_DO_AVISO = 8;
const ULTIMA_HORA_DO_AVISO = 20;

function horaDeInicio(period: ShiftPeriod, shift: string | null | undefined) {
  if (period === "NIGHT") return 19;
  return shift === "AFTERNOON" ? 13 : 7;
}

/** Quando a vaga do turno entra na repescagem, em hora local. */
export function aberturaDaRepescagem(date: string, period: ShiftPeriod, shift?: string | null): { date: string; hour: number } {
  let hora = horaDeInicio(period, shift) - HORAS_ANTES_DA_REPESCAGEM;
  let dia = date;
  if (hora < 0) {
    hora += 24;
    dia = addDaysToDateStr(date, -1);
  }
  if (hora > ULTIMA_HORA_DO_AVISO) return { date: dia, hour: ULTIMA_HORA_DO_AVISO };
  if (hora < PRIMEIRA_HORA_DO_AVISO) return { date: addDaysToDateStr(dia, -1), hour: ULTIMA_HORA_DO_AVISO };
  return { date: dia, hour: hora };
}

export function naRepescagem(date: string, period: ShiftPeriod, shift?: string | null, now: Date = new Date()): boolean {
  if (hasShiftStarted(date, period, shift, now)) return false;
  const abre = aberturaDaRepescagem(date, period, shift);
  const p = getBrazilNowParts(now);
  const hoje = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return hoje > abre.date || (hoje === abre.date && p.hour >= abre.hour);
}

/** Vagas livres que o interno da faculdade pega agora, direto: na janela, que cabem na viatura e que outra faculdade liberou. */
export async function vagasNaRepescagem(facultyId: string, now: Date = new Date()) {
  const hoje = localDateStr(now);
  const vagas = await listFreeOffers({ excludeFacultyId: facultyId, from: hoje, to: addDaysToDateStr(hoje, 1) });
  return soAsQueCabem(vagas
    .map((v) => ({ ...v, date: String(v.date).slice(0, 10), period: v.period as ShiftPeriod, tipo: goalKindOf(v.baseType) }))
    .filter((v) => naRepescagem(v.date, v.period, v.shift, now)));
}

/** Dos internos, os que já têm plantão extra no histórico (não cancelado, inclusive agendado). */
export async function comExtraNoHistorico(internIds: string[]): Promise<Set<string>> {
  if (!internIds.length) return new Set();
  const rows = await db
    .selectDistinct({ id: assignments.internId })
    .from(assignments)
    .where(and(inArray(assignments.internId, internIds), eq(assignments.isExtraShift, true), ne(assignments.status, "CANCELLED")));
  return new Set(rows.map((r) => r.id));
}

/** Se o cron do sorteio não rodar, a vaga não fica presa: passado isso da abertura, volta ao primeiro que pegar. */
const ESPERA_DO_SORTEIO_MIN = 30;

/** Vaga do turno está esperando o sorteio (aberta há menos de 30 min e ele não rodou)? */
export async function sorteioPendente(date: string, period: ShiftPeriod, now: Date = new Date()): Promise<boolean> {
  if (!naRepescagem(date, period, null, now)) return false;
  const abre = aberturaDaRepescagem(date, period, null);
  const p = getBrazilNowParts(now);
  const hoje = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const minutos = hoje === abre.date ? (p.hour - abre.hour) * 60 + p.minute : Infinity;
  return minutos < ESPERA_DO_SORTEIO_MIN && !(await sorteioFeito(date, period));
}

/** O sorteio do turno já rodou (sorteio-repescagem.ts)? */
export async function sorteioFeito(date: string, period: ShiftPeriod): Promise<boolean> {
  const [r] = await db.select({ id: sorteios.id }).from(sorteios).where(and(eq(sorteios.date, date), eq(sorteios.period, period))).limit(1);
  return Boolean(r);
}

export const TEXTO_JA_TEVE_EXTRA = "já tem um plantão extra no histórico: a vaga de última hora fica para quem precisa da meta ou ainda não teve extra.";
