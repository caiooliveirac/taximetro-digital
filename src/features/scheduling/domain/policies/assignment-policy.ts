export function canLeaderManageFaculty(params: {
  actorRole: string;
  actorFacultyId: string | null;
  targetFacultyId: string;
}) {
  if (params.actorRole !== "LEADER") return true;
  return params.actorFacultyId === params.targetFacultyId;
}

export function canMutateAssignments(actorRole: string) {
  return actorRole === "COORDINATOR" || actorRole === "LEADER";
}

/**
 * Quantos internos a ambulância comporta de fato num turno, independente da
 * grade. Grade com 1 vaga e 2 internos é decisão operacional legítima; 3 é
 * impossível fisicamente.
 */
export const LIMITE_FISICO_DE_INTERNOS_POR_TURNO = 2;

/**
 * Lotação de um turno inteiro (base + data + período), somando faculdades.
 *
 * A checagem por faculdade não segura sozinha: o assignment grava a faculdade
 * REAL do interno, não a da vaga. Dois internos UNIFACS ocupando a vaga UNIFACS
 * e a vaga ZARNS deixam a regra ZARNS contando zero — e abrem espaço para um
 * terceiro interno na mesma base. O que vale é gente na base contra as vagas.
 *
 * Dois tetos diferentes, de propósito:
 * - `aboveGrade`: passou da grade (2 internos numa vaga só). Avisa, não trava —
 *   quem escala às vezes precisa mesmo colocar dois onde a grade prevê um.
 * - `full` / `overcrowded`: passou do que cabe na viatura. Trava.
 *
 * capacity 0 = base sem grade naquele turno; aí não há teto a aplicar
 * (alocação livre do coordenador continua possível).
 */
export function computePeriodLoad(params: { capacity: number; occupied: number }) {
  const { capacity, occupied } = params;
  const limit = capacity > 0 ? Math.max(capacity, LIMITE_FISICO_DE_INTERNOS_POR_TURNO) : 0;

  return {
    capacity,
    occupied,
    limit,
    aboveGrade: capacity > 0 && occupied > capacity,
    full: limit > 0 && occupied >= limit,
    overcrowded: limit > 0 && occupied > limit,
  };
}

/**
 * Os dois avisos de lotação que a grade filtra:
 *  - superlotado: passou da grade (2 internos numa vaga) ou passou do que cabe
 *    na viatura (3 onde cabem 2). Perguntas diferentes, mesma peneira.
 *  - vaga bloqueada: turno no teto físico com vaga de grade ainda aberta — a
 *    vaga existe, mas não dá para alocar até liberarem um interno.
 */
export function computeCapacityFlags(params: {
  capacity: number;
  occupied: number;
  openRuleSlots: number;
}) {
  const load = computePeriodLoad({ capacity: params.capacity, occupied: params.occupied });
  return {
    overloaded: load.overcrowded || load.aboveGrade,
    blocked: load.full && params.openRuleSlots > 0,
  };
}

/**
 * O que a célula do turno mostra na grade semanal.
 *
 * Regra: interno nunca vai para o "+N". Um terceiro interno num turno de dois
 * é justamente o que precisa saltar aos olhos, e já sumiu atrás do "+1 item"
 * uma vez. A vaga que o teto físico bloqueou é que sai de cena — vira selo no
 * cabeçalho, porque é vaga que ninguém pode usar e um terceiro card só
 * desfigura a coluna. A lista completa continua no modal do turno.
 */
export function splitPeriodSlots<T extends { kind: string }>(slots: T[], limit: number) {
  const assignmentCount = slots.filter((slot) => slot.kind === "assignment").length;
  const hasVacancy = slots.some((slot) => slot.kind === "vacancy");
  const visibleLimit = Math.max(limit, assignmentCount);
  // Uma vaga alocável sempre cabe: se a célula está cheia de card (inclusive
  // plantão cancelado, que não ocupa vaga), quem escala ainda precisa ver que
  // dá para alocar ali.
  let vacancyRoom = Math.max(hasVacancy ? 1 : 0, visibleLimit - assignmentCount);

  const visible: T[] = [];
  const hidden: T[] = [];
  let blockedCount = 0;

  // Percorre na ordem original para não quebrar o agrupamento por faculdade.
  for (const slot of slots) {
    if (slot.kind === "assignment") {
      visible.push(slot);
      continue;
    }
    if (slot.kind === "blocked") {
      blockedCount += 1;
      continue;
    }
    if (vacancyRoom > 0) {
      visible.push(slot);
      vacancyRoom -= 1;
      continue;
    }
    hidden.push(slot);
  }

  return { visible, hidden, blockedCount, visibleLimit };
}
