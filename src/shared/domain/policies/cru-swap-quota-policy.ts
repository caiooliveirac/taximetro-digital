/**
 * Cota de troca de CRU: cada interno troca o dia de CRU dele uma vez por
 * rodízio. Antes disso um preceptor tinha que autorizar cada troca, mas ele não
 * fazia análise de mérito — e não tinha como perceber que o mesmo interno já
 * havia trocado no mesmo rodízio, que é justamente o que precisa ser barrado.
 *
 * A vigência do rodízio vem do CRU fixo do interno (`valid_from`/`valid_until`).
 * Interno sem CRU fixo ativo cai na janela corrida de 6 semanas a partir da
 * última troca concluída — mesma duração praticada no rodízio.
 */

export const CRU_SWAP_FALLBACK_WEEKS = 6;

export type CruSwapWindow = { from: string; to: string };

/** Janela em que as trocas de CRU do interno são contadas. */
export function resolveCruSwapWindow(params: {
  today: string;
  rotation: CruSwapWindow | null;
}): CruSwapWindow {
  const { today, rotation } = params;
  if (rotation && rotation.from <= today && today <= rotation.to) return rotation;
  // Sem rodízio para delimitar, a janela olha 6 semanas para trás e não fecha
  // para frente: a troca é contada pela data do plantão, que costuma ser
  // futura — fechar em "hoje" deixaria toda troca marcada adiante sem contar.
  return { from: addDays(today, -(CRU_SWAP_FALLBACK_WEEKS * 7 - 1)), to: "9999-12-31" };
}

/**
 * `swapDates` são as datas dos plantões de CRU que o interno já trocou.
 * Uma dentro da janela basta para bloquear a próxima.
 */
export function hasUsedCruSwapQuota(params: {
  window: CruSwapWindow;
  swapDates: string[];
}): boolean {
  const { window, swapDates } = params;
  return swapDates.some((date) => date >= window.from && date <= window.to);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
