import { listActiveCruFixedByFaculty } from "@/features/scheduling/infra/repositories/cru-fixed-repository";
import { canManageCruFixed, type SchedulingActor } from "@/features/scheduling/application/use-cases/cru-fixed-shared";

export async function executeListCruFixed(params: {
  actor: SchedulingActor;
}) {
  if (!canManageCruFixed(params.actor)) {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }

  const rows = await listActiveCruFixedByFaculty(params.actor.facultyId!);
  return { status: 200, body: { success: true, data: rows } } as const;
}
