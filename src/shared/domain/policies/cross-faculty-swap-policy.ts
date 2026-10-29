/**
 * Troca com interno de OUTRA faculdade — só USA.
 *
 * A grade conta vaga por faculdade pelo `assignments.facultyId`, e cada
 * interno segue com a própria faculdade no plantão que recebe (meta, relatório
 * e preceptor continuam certos). Para a faculdade que cedeu o plantão não ver
 * a vaga vazia — e o líder escalar outro, ou o cron de vaga livre liberar de
 * novo —, a troca registra cada plantão cedido como vaga liberada já ocupada,
 * `autoRelease = "TROCA"`: o mesmo caminho de uma vaga livre usada por outra
 * faculdade (ver auto-release-slots.ts, `deVagaLivre`).
 *
 * Só USA porque lá o teto da base é físico (uma viatura) e checado em todo
 * caminho de alocação; CRU tem grade e sorteio por faculdade, e o meio turno
 * do EBMSP não casa com o plantão de 12h das outras.
 */

export const TIPO_TROCA_ENTRE_FACULDADES = "USA";

export function podeTrocarEntreFaculdades(baseType: string | null | undefined): boolean {
  return baseType === TIPO_TROCA_ENTRE_FACULDADES;
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
