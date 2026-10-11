/**
 * Arquivamento de turma por interno: depois que a data de fim passa, cada
 * interno é arquivado só quando não tem mais plantão escalado de hoje em diante
 * (reposição marcada depois do fim do rodízio, por exemplo). A turma só fecha
 * quando o último interno for arquivado.
 */

export type ClosureIntern = {
  userRoleId: string;
  name: string;
  /** Data (YYYY-MM-DD) do último plantão ainda valendo (não cancelado nem falta), ou null. */
  lastShiftDate: string | null;
};

export type CohortClosurePlan = {
  /** Fim da turma ainda não passou: nada a arquivar. */
  ended: boolean;
  toArchive: ClosureIntern[];
  /** Internos que seguem ativos porque ainda têm plantão de hoje em diante. */
  pending: ClosureIntern[];
  /** Ninguém fica pendente: a turma pode ser fechada. */
  closeCohort: boolean;
};

export function planCohortClosure(params: {
  endDate: string;
  today: string;
  interns: ClosureIntern[];
}): CohortClosurePlan {
  if (params.endDate >= params.today) {
    return { ended: false, toArchive: [], pending: [], closeCohort: false };
  }
  const toArchive: ClosureIntern[] = [];
  const pending: ClosureIntern[] = [];
  for (const intern of params.interns) {
    if (intern.lastShiftDate && intern.lastShiftDate >= params.today) pending.push(intern);
    else toArchive.push(intern);
  }
  pending.sort((a, b) => a.lastShiftDate!.localeCompare(b.lastShiftDate!));
  return { ended: true, toArchive, pending, closeCohort: pending.length === 0 };
}

/**
 * Internos com plantão marcado depois do fim da turma e ainda por vir — os que
 * vão segurar o arquivamento. Aviso antecipado na tela de turmas.
 */
export function internsBeyondEnd<T extends { lastShiftDate: string | null }>(
  endDate: string,
  today: string,
  interns: T[],
): T[] {
  return interns.filter(
    (intern) => intern.lastShiftDate !== null && intern.lastShiftDate > endDate && intern.lastShiftDate >= today,
  );
}
