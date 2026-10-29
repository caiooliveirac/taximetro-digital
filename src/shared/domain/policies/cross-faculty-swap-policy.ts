/**
 * Troca com interno de OUTRA faculdade — USA e CRU.
 *
 * A grade conta vaga por faculdade pelo `assignments.facultyId`, e cada
 * interno segue com a própria faculdade no plantão que recebe (meta, relatório
 * e preceptor continuam certos). Para a faculdade que cedeu o plantão não ver
 * a vaga vazia — e o líder escalar outro, ou o cron de vaga livre liberar de
 * novo —, a troca registra cada plantão cedido como vaga liberada já ocupada,
 * `autoRelease = "TROCA"`: o mesmo caminho de uma vaga livre usada por outra
 * faculdade (ver auto-release-slots.ts, `deVagaLivre`).
 *
 * USA desde 2026-10-29 (teto físico da viatura checado em todo caminho). CRU
 * no mesmo dia, a pedido do Caio: a cota de uma troca de CRU por rodízio vale
 * igual, e a vaga cedida sai da grade da faculdade dona em toda conta
 * (turnos_livres, getRequestableSlots, checkSlotAvailability, CRU fixo) — na
 * CRU não há teto físico para segurar lotação. O meio turno do EBMSP, que não
 * casaria com o plantão de 12h das outras, está desligado desde 2026-09-22.
 * CRL segue dentro da faculdade.
 */

export const TIPOS_TROCA_ENTRE_FACULDADES = new Set(["USA", "CENTRAL"]);

export function podeTrocarEntreFaculdades(baseType: string | null | undefined): boolean {
  return Boolean(baseType && TIPOS_TROCA_ENTRE_FACULDADES.has(baseType));
}

type PlantaoTrocado = {
  internId: string;
  facultyId: string;
  baseId: string;
  date: string;
  period: "DAY" | "NIGHT";
  shift: string | null;
};

/**
 * As vagas cedidas numa troca: para cada lado, o plantão que saiu da
 * faculdade dona e foi para o interno da outra. Vazio quando é a mesma
 * faculdade — aí nada muda na grade.
 */
export function cessoesDaTroca(params: {
  original: PlantaoTrocado;
  alvo: PlantaoTrocado;
  /** Plantão novo de quem recebe o `original` (o interno do alvo) e vice-versa. */
  novoDoAlvo: string;
  novoDoOriginal: string;
  publishedBy: string;
  agora: Date;
}) {
  const { original, alvo } = params;
  if (original.facultyId === alvo.facultyId) return [];
  const cessao = (cedido: PlantaoTrocado, quemRecebe: string, assignmentId: string) => ({
    baseId: cedido.baseId,
    date: cedido.date,
    period: cedido.period,
    shift: cedido.shift,
    releasedFacultyId: cedido.facultyId,
    claimedBy: quemRecebe,
    claimedAt: params.agora,
    assignmentId,
    publishedBy: params.publishedBy,
    autoRelease: "TROCA" as const,
    notes: "Cedida numa troca entre internos de faculdades diferentes",
  });
  return [
    cessao(original, alvo.internId, params.novoDoAlvo),
    cessao(alvo, original.internId, params.novoDoOriginal),
  ];
}
