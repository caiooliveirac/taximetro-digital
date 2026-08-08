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
