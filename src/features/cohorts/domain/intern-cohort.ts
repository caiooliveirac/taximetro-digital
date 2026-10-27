/**
 * Interno ativo nunca fica sem turma: sem turma ele some do sorteio, da
 * cobertura e das telas que filtram por turma. Quem entra numa faculdade
 * cai na turma aberta dela; se não houver nenhuma, nasce a próxima.
 */

/** Cada turma tem no máximo dois líderes de escala. */
export const MAX_LEADERS_PER_COHORT = 2;

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
 * Início da próxima turma: o dia seguinte ao fim da turma em curso — os
 * internos novos costumam se cadastrar na última semana da atual —, ou hoje
 * se nenhuma está em curso.
 */
export function nextCohortStart(current: { status: string; endDate: string } | null, today: string): string {
  if (!current || current.status === "CLOSED" || current.endDate < today) return today;
  return addDays(current.endDate, 1);
}

/** A partir da 4ª semana da turma em curso, o convite já é para a próxima. */
const NEW_COHORT_DEFAULT_AFTER_DAYS = 21;

/**
 * Turma pré-selecionada no convite de interno ("" = nova turma). Turma
 * futura já criada vence (é o grupo que está chegando); a em curso só até
 * a 3ª semana; depois disso, ou sem nenhuma aberta, nova turma.
 */
export function defaultInviteCohortId(cohorts: OpenCohortCandidate[], today: string): string {
  const upcoming = cohorts
    .filter((c) => c.status !== "CLOSED" && c.startDate > today)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (upcoming) return upcoming.id;
  const current = pickOpenCohort(cohorts, today);
  if (current && today < addDays(current.startDate, NEW_COHORT_DEFAULT_AFTER_DAYS)) return current.id;
  return "";
}

/**
 * Próxima turma da faculdade: começa quando a em curso termina (ou hoje) e
 * dura o mesmo que a última (o coordenador ajusta as datas na tela de Turmas).
 */
export function planNextCohort(params: {
  facultyAbbr: string;
  today: string;
  last: { rotationNumber: number; status: string; startDate: string; endDate: string } | null;
}) {
  const rotationNumber = (params.last?.rotationNumber ?? 0) + 1;
  const length = params.last ? Math.max(daysBetween(params.last.startDate, params.last.endDate), 7) : DEFAULT_ROTATION_DAYS;
  const startDate = nextCohortStart(params.last, params.today);
  const name = `${params.facultyAbbr} ${rotationNumber}`;
  return {
    rotationNumber,
    startDate,
    endDate: addDays(startDate, length),
    name,
    label: name,
  };
}
