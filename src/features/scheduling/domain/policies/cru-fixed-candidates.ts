/**
 * Quem aparece na lista do "CRU Fixo Semanal" do líder.
 *
 * Regras (nesta ordem):
 * 1. mesmo dia+período que o interno já tem: nunca aparece (é duplicata, o banco recusa)
 * 2. com busca por nome: qualquer interno da faculdade que casar com o texto — é assim
 *    que se escala um segundo fixo, que é exceção e não deve estar na lista padrão
 * 3. sem busca: só a turma cujas datas cobrem a janela do rodízio, e só quem ainda
 *    não tem nenhum fixo. Interno sem turma cadastrada aparece (não dá para julgar).
 */

export type CandidateIntern = {
  id: string;
  name: string;
  cohortStart?: string | null;
  cohortEnd?: string | null;
};

export type CandidateFixed = {
  intern_id: string;
  day_of_week: string;
  period: string;
};

export function filterCruFixedCandidates<T extends CandidateIntern>(params: {
  interns: T[];
  cruFixed: CandidateFixed[];
  dayOfWeek: string;
  period: "DAY" | "NIGHT";
  /** primeiro dia da janela do rodízio (segunda da semana corrente) */
  windowStart: string;
  /** último dia da janela (windowStart + semanas * 7 - 1) */
  windowEnd: string;
  search: string;
}): { list: T[]; hiddenWithFixed: number; hiddenOtherCohort: number } {
  const query = params.search.trim().toLowerCase();
  const fixedByIntern = new Map<string, CandidateFixed[]>();
  for (const fixed of params.cruFixed) {
    fixedByIntern.set(fixed.intern_id, [...(fixedByIntern.get(fixed.intern_id) ?? []), fixed]);
  }

  let hiddenWithFixed = 0;
  let hiddenOtherCohort = 0;

  const list = params.interns
    .filter((intern) => {
      const own = fixedByIntern.get(intern.id) ?? [];
      if (own.some((f) => f.day_of_week === params.dayOfWeek && f.period === params.period)) return false;

      if (query) return intern.name.toLowerCase().includes(query);

      if (intern.cohortStart && intern.cohortEnd
        && (intern.cohortEnd < params.windowStart || intern.cohortStart > params.windowEnd)) {
        hiddenOtherCohort += 1;
        return false;
      }

      if (own.length > 0) {
        hiddenWithFixed += 1;
        return false;
      }

      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return { list, hiddenWithFixed, hiddenOtherCohort };
}
