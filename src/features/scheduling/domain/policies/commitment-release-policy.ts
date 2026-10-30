/**
 * Liberações da agenda acadêmica — a regra, sem banco.
 *
 * O interno que perdeu plantão por compromisso da turma fica PENDENTE até a
 * coordenação (ou o líder) decidir, com um toque:
 * - ABONADO: o plantão conta na meta como abonado. Nada mais a fazer.
 * - REPOR: o interno deve o plantão. Enquanto faltar plantão daquele tipo na
 *   meta dele, entra na frente no sorteio da repescagem (dentro de cada
 *   critério) e a Dai avisa uma vez por dia para se inscrever nos sorteios.
 *   Fechou a meta no tipo, a reposição está feita — sem baixa manual.
 */

import { goalKindOf, type GoalKind } from "@/lib/goal-slots";

/** Quantos dias para trás a aba mostra. */
export const JANELA_LIBERACOES_DIAS = 60;

export type Resolucao = "PENDENTE" | "ABONADO" | "REPOR";

/** Ainda deve: marcado para repor e com casinha vazia no tipo do plantão perdido. */
export function aindaDeveRepor(
  rel: { resolution: Resolucao; baseType: string },
  faltam: Partial<Record<GoalKind, number>> | undefined,
): boolean {
  if (rel.resolution !== "REPOR") return false;
  const kind = goalKindOf(rel.baseType);
  return Boolean(kind && (faltam?.[kind] ?? 0) > 0);
}

/** Quem deve reposição vai à frente, sem mexer na ordem sorteada entre eles. */
export function ordemComReposicao<T extends { internId: string }>(ordem: T[], devem: Set<string>): T[] {
  return [...ordem.filter((c) => devem.has(c.internId)), ...ordem.filter((c) => !devem.has(c.internId))];
}
