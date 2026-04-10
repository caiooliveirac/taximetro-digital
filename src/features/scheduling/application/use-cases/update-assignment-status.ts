import { logAudit } from "@/shared/infra/logger/audit";
import { canLeaderManageFaculty } from "@/features/scheduling/domain/policies/assignment-policy";
import { findAssignmentFacultyById, updateAssignmentStatus } from "@/features/scheduling/infra/repositories/assignment-repository";

type AssignmentActor = {
  id: string;
  role: string;
  facultyId: string | null;
  isImpersonating: boolean;
  realUserId: string | null;
};

export async function executeUpdateAssignmentStatus(params: {
  actor: AssignmentActor;
  input: {
    id?: string;
    status: string;
    notes?: string;
  };
}) {
  const { actor, input } = params;

  if (!input.id) {
    return { status: 400, body: { success: false, error: "ID obrigatório" } } as const;
  }

  if (actor.role === "LEADER") {
    const target = await findAssignmentFacultyById(input.id);

    if (!target || !canLeaderManageFaculty({
      actorRole: actor.role,
      actorFacultyId: actor.facultyId,
      targetFacultyId: target.facultyId,
    })) {
      return {
        status: 403,
        body: { success: false, error: "Assignment não pertence à sua faculdade" },
      } as const;
    }
  }

  const updated = await updateAssignmentStatus({
    id: input.id,
    status: input.status,
    notes: input.notes,
  });

  if (!updated) {
    return { status: 404, body: { success: false, error: "Assignment não encontrado" } } as const;
  }

  const auditAction = (updated.isExtraShift && input.status === "CANCELLED")
    ? "EXTRA_SHIFT_CANCELLED"
    : "UPDATE_ASSIGNMENT";

  await logAudit({
    userId: actor.realUserId ?? actor.id,
    action: auditAction,
    entity: "assignment",
    entityId: input.id,
    payload: {
      status: input.status,
      notes: input.notes,
      isExtraShift: updated.isExtraShift,
      ...(actor.isImpersonating ? { impersonating: actor.id } : {}),
    },
  });

  return { status: 200, body: { success: true, data: updated } } as const;
}
