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
 * Lotação de um turno inteiro (base + data + período), somando faculdades.
 *
 * A checagem por faculdade não segura sozinha: o assignment grava a faculdade
 * REAL do interno, não a da vaga. Dois internos UNIFACS ocupando a vaga UNIFACS
 * e a vaga ZARNS deixam a regra ZARNS contando zero — e abrem espaço para um
 * terceiro interno na mesma base. O que vale é gente na base contra a soma das
 * vagas da grade.
 *
 * capacity 0 = base sem grade naquele turno; aí não há teto a aplicar
 * (alocação livre do coordenador continua possível).
 */
export function computePeriodLoad(params: { capacity: number; occupied: number }) {
  const { capacity, occupied } = params;
  return {
    capacity,
    occupied,
    full: capacity > 0 && occupied >= capacity,
    overcrowded: capacity > 0 && occupied > capacity,
  };
}
