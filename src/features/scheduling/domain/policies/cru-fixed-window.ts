import { addDaysToDateStr, startOfWeekDateStr } from "@/lib/utils";

/**
 * Janela de vigência de um CRU fixo semanal.
 *
 * A turma manda. Início e fim do rodízio são os da turma do interno (tabela
 * `cohorts`, editável na tela Turmas) — é lá que essas datas são pensadas, e
 * repetir a conta em outro lugar foi o que produziu rodízios tortos: contar
 * "N semanas a partir de agora" inclui a semana que já está correndo, então
 * "6 semanas" virava 5 semanas e meia e passava por cima da turma anterior.
 *
 * `weeks` só entra quando o interno não tem turma cadastrada — aí não há de onde
 * tirar as datas e o líder informa a duração. Nesse caso a janela começa na
 * segunda da semana corrente, comportamento antigo.
 */

export type CohortWindow = { startDate: string; endDate: string } | null | undefined;

export type CruFixedWindow = {
  /** vigência do template — o que a cota de troca de CRU enxerga */
  validFrom: string;
  validUntil: string;
  /** primeiro dia a materializar: nunca antes do início da janela, nunca no passado */
  materializeFrom: string;
  source: "cohort" | "weeks";
};

export function computeCruFixedWindow(params: {
  today: string;
  cohort: CohortWindow;
  weeks?: number | null;
}): CruFixedWindow {
  if (params.cohort) {
    const { startDate, endDate } = params.cohort;
    return {
      validFrom: startDate,
      validUntil: endDate,
      materializeFrom: startDate > params.today ? startDate : params.today,
      source: "cohort",
    };
  }

  const weekStart = startOfWeekDateStr(params.today);
  const weeks = params.weeks && params.weeks > 0 ? params.weeks : 1;

  return {
    validFrom: weekStart,
    validUntil: addDaysToDateStr(weekStart, weeks * 7 - 1),
    materializeFrom: params.today,
    source: "weeks",
  };
}

/** Quantas semanas a janela cobre — só para exibir, o cálculo real é por data. */
export function contarSemanas(validFrom: string, validUntil: string): number {
  const dias = Math.round(
    (Date.parse(`${validUntil}T12:00:00Z`) - Date.parse(`${validFrom}T12:00:00Z`)) / 86_400_000,
  ) + 1;
  return Math.max(1, Math.ceil(dias / 7));
}
