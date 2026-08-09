/**
 * Turmas disponíveis no sorteio do líder e qual delas já vem escolhida.
 *
 * O líder com turma vinculada só recebe os internos dela (ver
 * `/api/leader/interns`), então para ele a lista tem uma turma só. Quem entra
 * por impersonate a partir de um líder sem turma — o caso do COORDINATOR —
 * recebe a faculdade inteira, várias turmas de uma vez, e é aí que sortear sem
 * recorte escala gente de turma que já acabou.
 *
 * Regras:
 * 1. a turma do interno é o `cohortId` do vínculo; quem não tem cai em
 *    `SEM_TURMA`, que aparece por último e nunca é escolhida automaticamente
 * 2. pré-seleção: a turma que cruza a semana sendo sorteada. Em semana de
 *    virada, duas cruzam — vale a que começou depois, que é a que ainda tem
 *    escala para montar
 * 3. sem nenhuma turma cruzando a semana (ou sem turma alguma cadastrada),
 *    ninguém é escondido: fica em `TODAS_AS_TURMAS`
 */

export const TODAS_AS_TURMAS = "__todas__";
export const SEM_TURMA = "__sem_turma__";

export type InternoDoSorteio = {
  id: string;
  name: string;
  roleActive: boolean;
  cohortId?: string | null;
  cohortName?: string | null;
  cohortLabel?: string | null;
  cohortStart?: string | null;
  cohortEnd?: string | null;
};

export type TurmaDoSorteio = {
  /** `cohortId` da turma, ou `SEM_TURMA` */
  key: string;
  label: string;
  start: string | null;
  end: string | null;
  /** internos com papel ativo — os únicos que o sorteio usa */
  ativos: number;
  total: number;
};

function chaveDaTurma(interno: InternoDoSorteio) {
  return interno.cohortId ?? SEM_TURMA;
}

/** Agrupa os internos carregados no modal pelas turmas que eles têm. */
export function turmasDoSorteio(interns: InternoDoSorteio[]): TurmaDoSorteio[] {
  const porChave = new Map<string, TurmaDoSorteio>();

  for (const interno of interns) {
    const key = chaveDaTurma(interno);
    const atual = porChave.get(key);

    if (!atual) {
      porChave.set(key, {
        key,
        label: key === SEM_TURMA
          ? "Sem turma"
          : interno.cohortName ?? interno.cohortLabel ?? "Turma sem nome",
        start: interno.cohortStart ?? null,
        end: interno.cohortEnd ?? null,
        ativos: interno.roleActive ? 1 : 0,
        total: 1,
      });
      continue;
    }

    atual.total += 1;
    if (interno.roleActive) atual.ativos += 1;
  }

  // Mais recente primeiro; "Sem turma" sempre por último.
  return [...porChave.values()].sort((left, right) => {
    if (left.key === SEM_TURMA) return 1;
    if (right.key === SEM_TURMA) return -1;
    const porInicio = (right.start ?? "").localeCompare(left.start ?? "");
    if (porInicio !== 0) return porInicio;
    return left.label.localeCompare(right.label);
  });
}

/**
 * Turma que já vem escolhida ao abrir o sorteio: a que cruza a semana
 * (`weekStart` até `weekStart` + 6 dias). Empate na semana de virada vai para a
 * que começou depois. Nenhuma cruzando → `TODAS_AS_TURMAS`.
 */
export function turmaPadraoDoSorteio(
  turmas: TurmaDoSorteio[],
  weekStart: string,
  diasDaSemana = 7,
): string {
  const weekEnd = somaDias(weekStart, diasDaSemana - 1);

  const cruzamAsemana = turmas.filter((turma) => {
    if (turma.key === SEM_TURMA) return false;
    if (!turma.start || !turma.end) return false;
    if (turma.ativos === 0) return false;
    return turma.start <= weekEnd && turma.end >= weekStart;
  });

  if (cruzamAsemana.length === 0) return TODAS_AS_TURMAS;

  const escolhida = cruzamAsemana.reduce((melhor, turma) =>
    (turma.start ?? "") > (melhor.start ?? "") ? turma : melhor,
  );

  return escolhida.key;
}

/** Internos de uma turma. `TODAS_AS_TURMAS` devolve a lista inteira. */
export function internosDaTurma<T extends InternoDoSorteio>(interns: T[], key: string): T[] {
  if (key === TODAS_AS_TURMAS) return interns;
  return interns.filter((interno) => chaveDaTurma(interno) === key);
}

function somaDias(dateStr: string, dias: number): string {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dias);
  return date.toISOString().slice(0, 10);
}
