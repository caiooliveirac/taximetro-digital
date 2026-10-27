/**
 * Meta do interno no tipo da vaga livre (USA/CRU/CRL): a mesma conta das
 * casinhas — realizados com checkout, o plantão em andamento e os agendados
 * da rotação. Falta e plantão passado sem checkout não contam.
 *
 * O líder escala em vaga livre sozinho só quem ainda está abaixo da meta;
 * acima disso vira pedido para a coordenação (claim-extra-offer.ts).
 */

import { executeGetComplianceOverview } from "@/features/compliance/application/use-cases/get-compliance-overview";
import { goalKindOf, type GoalKind } from "@/lib/goal-slots";

export type MetaNoTipo = { kind: GoalKind; target: number; missing: number; cumprida: boolean };

/** null = sem como medir (tipo sem meta conhecida ou interno fora do compliance): não trava. */
export async function metaDoInternoNoTipo(internId: string, baseType: string): Promise<MetaNoTipo | null> {
  const kind = goalKindOf(baseType);
  if (!kind) return null;
  const { data } = await executeGetComplianceOverview({
    actor: { id: "", role: "COORDINATOR", facultyId: null },
    internId,
  });
  const row = data.find((r) => r.userId === internId);
  if (!row) return null;
  const target = row[`target${kind}Total`];
  const missing = row[`missing${kind}`];
  return { kind, target, missing, cumprida: missing === 0 };
}

export function textoMetaCumprida(internName: string, meta: MetaNoTipo) {
  return `${internName} já tem a meta de ${meta.kind} coberta (${meta.target} na rotação, contando realizados, o de hoje e os agendados). Peça autorização à coordenação.`;
}
