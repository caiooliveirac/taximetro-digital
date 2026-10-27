/**
 * Interno ativo nunca fica sem turma: sem turma ele some do sorteio, da
 * cobertura e das telas que filtram por turma. Quem entra numa faculdade
 * cai na turma aberta dela; se não houver nenhuma, nasce a próxima.
 */

/** Rodízio padrão quando a faculdade ainda não tem turma para servir de molde. */
const DEFAULT_ROTATION_DAYS = 41;

export type OpenCohortCandidate = {
  id: string;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
  startDate: string;
  endDate: string;
};

/**
 * Turma aberta onde o interno entra: não fechada e ainda dentro do prazo.
 * ACTIVE vence PLANNED; entre iguais, a mais recente (o grupo que acabou de
 * chegar, não o que está saindo).
 */
export function pickOpenCohort<T extends OpenCohortCandidate>(cohorts: T[], today: string): T | null {
  const open = cohorts.filter((c) => c.status !== "CLOSED" && c.endDate >= today);
  open.sort((a, b) =>
    Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") || b.startDate.localeCompare(a.startDate));
  return open[0] ?? null;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Próxima turma da faculdade: começa hoje e dura o mesmo que a última
 * (o coordenador ajusta as datas depois, na tela de Turmas).
 */
export function planNextCohort(params: {
  facultyAbbr: string;
  today: string;
  last: { rotationNumber: number; startDate: string; endDate: string } | null;
}) {
  const rotationNumber = (params.last?.rotationNumber ?? 0) + 1;
  const length = params.last ? Math.max(daysBetween(params.last.startDate, params.last.endDate), 7) : DEFAULT_ROTATION_DAYS;
  const name = `${params.facultyAbbr} ${rotationNumber}`;
  return {
    rotationNumber,
    startDate: params.today,
    endDate: addDays(params.today, length),
    name,
    label: name,
  };
}
