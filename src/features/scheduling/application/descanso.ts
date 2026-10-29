/**
 * Descanso de 12h em todo caminho que dá plantão a um interno: troca, escala
 * do líder, extra, vaga livre e extra da grade. A regra é de rest-policy.ts;
 * isto só busca a agenda em volta do turno novo.
 */

import { findInternTurnosBetween } from "@/features/requests/infra/repositories/request-repository";
import { mensagemSemDescanso, plantaoSemDescanso, type TurnoDePlantao } from "@/shared/domain/policies/rest-policy";
import { addDaysToDateStr } from "@/lib/utils";

/** Frase pronta ("Você ficaria com dois plantões seguidos…") ou null se o descanso está garantido. */
export async function semDescansoPara(internId: string, quem: string, novo: TurnoDePlantao): Promise<string | null> {
  const date = novo.date.slice(0, 10);
  const outros = await findInternTurnosBetween({ internId, dateFrom: addDaysToDateStr(date, -1), dateTo: addDaysToDateStr(date, 1) });
  const conflito = plantaoSemDescanso({ ...novo, date }, outros.map((o) => ({ ...o, date: String(o.date).slice(0, 10), period: o.period as "DAY" | "NIGHT" })));
  return conflito ? mensagemSemDescanso(quem, { ...novo, date }, conflito) : null;
}
