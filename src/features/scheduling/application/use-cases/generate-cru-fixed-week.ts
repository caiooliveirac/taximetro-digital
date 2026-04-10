import { z } from "zod/v4";
import { materializeCruFixedAssignments } from "@/lib/cru-fixed";
import { addDaysToDateStr, localDateStr } from "@/lib/utils";
import { logAudit } from "@/shared/infra/logger/audit";
import { canManageCruFixed, type SchedulingActor } from "@/features/scheduling/application/use-cases/cru-fixed-shared";
import { countCruFixedTemplatesForWeek } from "@/features/scheduling/infra/repositories/cru-fixed-repository";

export const generateCruFixedWeekSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function executeGenerateCruFixedWeek(params: {
  actor: SchedulingActor;
  input: z.infer<typeof generateCruFixedWeekSchema>;
}) {
  const { actor, input } = params;

  if (!canManageCruFixed(actor)) {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }

  const templatesCount = await countCruFixedTemplatesForWeek({
    facultyId: actor.facultyId!,
    weekStart: input.weekStart,
  });

  if (templatesCount === 0) {
    return { status: 200, body: { success: true, created: 0, message: "Nenhum fixo CRU cadastrado" } } as const;
  }

  const weekEnd = addDaysToDateStr(input.weekStart, 6);
  const sync = await materializeCruFixedAssignments({
    facultyId: actor.facultyId!,
    startDate: input.weekStart > localDateStr() ? input.weekStart : localDateStr(),
    endDate: weekEnd,
    actorUserId: actor.realUserId ?? actor.id,
  });

  await logAudit({
    userId: actor.realUserId ?? actor.id,
    action: "CRU_FIXED_GENERATE",
    entity: "cru_fixed_assignments",
    payload: { weekStart: input.weekStart, templatesCount, ...sync },
  });

  return {
    status: 200,
    body: {
      success: true,
      created: sync.createdCount,
      updated: sync.updatedCount,
      reactivated: sync.reactivatedCount,
      unchanged: sync.unchangedCount,
      skipped: sync.skippedCount,
      total: sync.plannedCount,
      data: sync,
    },
  } as const;
}
