/**
 * Aba Liberações: quem perdeu plantão por compromisso da turma, por
 * faculdade, e o toque que decide (abonar ou repor). Regra em
 * commitment-release-policy.ts.
 */

import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import { addDaysToDateStr, localDateStr } from "@/lib/utils";
import { executeGetComplianceOverview } from "@/features/compliance/application/use-cases/get-compliance-overview";
import { getRelease, listReleases, setResolution } from "@/features/scheduling/infra/repositories/commitment-release-repository";
import { aindaDeveRepor, JANELA_LIBERACOES_DIAS } from "@/features/scheduling/domain/policies/commitment-release-policy";
import { GOAL_KINDS, type GoalKind } from "@/lib/goal-slots";
import type { SchedulingActor } from "./cru-fixed-shared";

export const resolveReleaseSchema = z.object({
  id: z.string().uuid(),
  resolution: z.enum(["ABONADO", "REPOR"]),
});

/** Líder: a faculdade dele. Coordenador: a escolhida, ou todas (null). */
function escopo(actor: SchedulingActor, facultyId?: string | null): { ok: true; facultyId: string | null } | { ok: false } {
  if (actor.role === "LEADER" && actor.facultyId) return { ok: true, facultyId: actor.facultyId };
  if (actor.role === "COORDINATOR") return { ok: true, facultyId: facultyId ?? null };
  return { ok: false };
}

/** Faltas na meta por interno, a mesma conta das telas de meta. */
async function faltamPorInterno(facultyId: string | null) {
  const { data } = await executeGetComplianceOverview({
    actor: { id: "", role: "COORDINATOR", facultyId: null },
    facultyId,
  });
  return new Map(data.map((r) => [r.userId, Object.fromEntries(GOAL_KINDS.map((k) => [k, r[`missing${k}`]])) as Record<GoalKind, number>]));
}

export async function executeListReleases(params: { actor: SchedulingActor; facultyId?: string | null }) {
  const e = escopo(params.actor, params.facultyId);
  if (!e.ok) return { status: 403, body: { success: false, error: "Sem permissão" } } as const;

  const rows = await listReleases({ facultyId: e.facultyId, from: addDaysToDateStr(localDateStr(), -JANELA_LIBERACOES_DIAS) });
  const faltam = rows.length ? await faltamPorInterno(e.facultyId) : new Map<string, Record<GoalKind, number>>();

  const itens = rows.map((r) => ({
    ...r,
    faltam: faltam.get(r.internId) ?? null,
    deve: aindaDeveRepor(r, faltam.get(r.internId)),
  }));
  const resumo = {
    pendentes: itens.filter((i) => i.resolution === "PENDENTE").length,
    repor: itens.filter((i) => i.deve).length,
    repostos: itens.filter((i) => i.resolution === "REPOR" && !i.deve).length,
    abonados: itens.filter((i) => i.resolution === "ABONADO").length,
  };
  return { status: 200, body: { success: true, data: { itens, resumo } } } as const;
}

export async function executeResolveRelease(params: { actor: SchedulingActor; input: z.infer<typeof resolveReleaseSchema> }) {
  const e = escopo(params.actor);
  if (!e.ok) return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  const rel = await getRelease(params.input.id);
  if (!rel || (e.facultyId && rel.facultyId !== e.facultyId)) {
    return { status: 404, body: { success: false, error: "Liberação não encontrada" } } as const;
  }

  const autor = params.actor.realUserId ?? params.actor.id;
  await setResolution({ id: rel.id, resolution: params.input.resolution, resolvedBy: autor });
  await logAudit({
    userId: autor,
    action: params.input.resolution === "ABONADO" ? "RELEASE_EXCUSED" : "RELEASE_TO_REPLACE",
    entity: "commitment_releases",
    entityId: rel.id,
    payload: {
      internId: rel.internId, date: rel.date, period: rel.period, antes: rel.resolution,
      ...(params.actor.isImpersonating ? { impersonating: params.actor.id } : {}),
    },
  });
  return { status: 200, body: { success: true, data: { id: rel.id, resolution: params.input.resolution } } } as const;
}
