import { localDateStr } from "@/lib/utils";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  listCohortsForLifecycle,
  activateCohort,
  closeCohortAndArchiveInterns,
} from "@/features/cohorts/infra/repositories/cohort-repository";

export type CohortLifecycleResult = {
  today: string;
  activated: Array<{ cohortId: string; label: string }>;
  closed: Array<{ cohortId: string; label: string; archivedInterns: number }>;
};

/**
 * Avalia as datas de início/fim das turmas e aplica transições de status:
 *  - PLANNED com startDate <= hoje  → ACTIVE
 *  - qualquer turma com endDate < hoje → CLOSED + arquiva todos os internos
 *
 * Idempotente: roda diariamente via cron e também sob demanda ao salvar datas
 * de uma turma. Passe `cohortId` para avaliar apenas uma turma.
 *
 * `actorUserId` é gravado em closed_by/archived_by; o cron passa `null`.
 */
export async function evaluateCohortLifecycle(params?: {
  cohortId?: string;
  actorUserId?: string | null;
}): Promise<CohortLifecycleResult> {
  const today = localDateStr();
  const actorUserId = params?.actorUserId ?? null;
  const cohorts = await listCohortsForLifecycle(params?.cohortId);

  const result: CohortLifecycleResult = { today, activated: [], closed: [] };

  for (const cohort of cohorts) {
    // Fim já passou → fecha e arquiva (vale para PLANNED ou ACTIVE).
    if (cohort.endDate < today) {
      const archivedInterns = await closeCohortAndArchiveInterns({
        cohortId: cohort.id,
        closedBy: actorUserId,
      });
      result.closed.push({ cohortId: cohort.id, label: cohort.label, archivedInterns });
      await logAudit({
        userId: actorUserId ?? undefined,
        action: "AUTO_CLOSE_COHORT",
        entity: "cohort",
        entityId: cohort.id,
        payload: { endDate: cohort.endDate, today, archivedInterns },
      });
      continue;
    }

    // Início já chegou e ainda está PLANNED → ativa.
    if (cohort.status === "PLANNED" && cohort.startDate <= today) {
      await activateCohort(cohort.id);
      result.activated.push({ cohortId: cohort.id, label: cohort.label });
      await logAudit({
        userId: actorUserId ?? undefined,
        action: "AUTO_ACTIVATE_COHORT",
        entity: "cohort",
        entityId: cohort.id,
        payload: { startDate: cohort.startDate, today },
      });
    }
  }

  return result;
}
