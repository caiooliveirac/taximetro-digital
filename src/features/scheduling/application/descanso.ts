/**
 * Descanso de 12h em todo caminho que dá plantão a um interno: troca, escala
 * do líder, extra, vaga livre e extra da grade. A regra é de rest-policy.ts;
 * isto só busca a agenda em volta do turno novo.
 */

import { findInternTurnosBetween } from "@/features/requests/infra/repositories/request-repository";
import { mensagemSemDescanso, plantaoSemDescanso, type TurnoDePlantao } from "@/shared/domain/policies/rest-policy";
import { addDaysToDateStr } from "@/lib/utils";
import { academicBlockFor } from "@/features/scheduling/infra/repositories/academic-commitment-repository";
import { mensagemDeBloqueio } from "@/features/scheduling/domain/policies/academic-commitment-policy";

/** Frase pronta ("Você ficaria com dois plantões seguidos…") ou null se o descanso está garantido. */
export async function semDescansoPara(internId: string, quem: string, novo: TurnoDePlantao): Promise<string | null> {
  const date = novo.date.slice(0, 10);
  const outros = await findInternTurnosBetween({ internId, dateFrom: addDaysToDateStr(date, -1), dateTo: addDaysToDateStr(date, 1) });
  const conflito = plantaoSemDescanso({ ...novo, date }, outros.map((o) => ({ ...o, date: String(o.date).slice(0, 10), period: o.period as "DAY" | "NIGHT" })));
  return conflito ? mensagemSemDescanso(quem, { ...novo, date }, conflito) : null;
}

/**
 * Prova/atividade fixa da turma no turno (agenda acadêmica): frase pronta ou
 * null. Vale nos mesmos caminhos do descanso.
 */
export async function compromissoAcademicoPara(internId: string, quem: string, turno: { date: string; period: "DAY" | "NIGHT" }): Promise<string | null> {
  const date = turno.date.slice(0, 10);
  const titulo = await academicBlockFor(internId, date, turno.period);
  return titulo ? mensagemDeBloqueio(quem, titulo, { date, period: turno.period }) : null;
}
