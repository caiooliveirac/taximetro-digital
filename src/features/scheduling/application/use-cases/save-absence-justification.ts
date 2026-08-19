import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  findAssignmentForAbsenceJustification,
  saveAbsenceJustification,
} from "@/features/scheduling/infra/repositories/assignment-query-repository";

export const absenceJustificationSchema = z.object({
  justification: z.string().trim().min(5).max(2000),
});

type Actor = {
  id: string;
  role: string;
  facultyId: string | null;
  isImpersonating: boolean;
  realUserId: string | null;
};

export async function executeSaveAbsenceJustification(params: {
  actor: Actor;
  assignmentId: string;
  input: z.infer<typeof absenceJustificationSchema>;
}) {
  const { actor, assignmentId, input } = params;

  const assignment = await findAssignmentForAbsenceJustification(assignmentId);
  if (!assignment) return { status: 404, body: { success: false, error: "Plantão não encontrado" } } as const;
  if (assignment.status !== "ABSENT" && assignment.status !== "EXCUSED") {
    return {
      status: 409,
      body: { success: false, error: "Só é possível justificar plantões marcados como falta" },
    } as const;
  }

  if (actor.role === "INTERN" && assignment.internId !== actor.id) {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }

  if (actor.role === "LEADER" && assignment.facultyId !== actor.facultyId) {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }

  const actorType = actor.role === "INTERN" ? "INTERN" : actor.role === "LEADER" ? "LEADER" : "COORDINATOR";
  const updated = await saveAbsenceJustification({
    assignmentId: assignment.id,
    justification: input.justification,
    actor: actorType,
  });

  if (!updated) {
    return {
      status: 409,
      body: { success: false, error: "O plantão mudou de status antes da gravação. Atualize a página." },
    } as const;
  }

  await logAudit({
    userId: actor.realUserId ?? actor.id,
    action: "SAVE_ABSENCE_JUSTIFICATION",
    entity: "assignment",
    entityId: assignment.id,
    payload: {
      assignmentDate: assignment.date,
      assignmentPeriod: assignment.period,
      internId: assignment.internId,
      facultyId: assignment.facultyId,
      actor: actorType,
      justificationLength: input.justification.length,
      ...(actor.isImpersonating ? { impersonating: actor.id, impersonateRole: actor.role } : {}),
    },
  });

  return { status: 200, body: { success: true, data: updated } } as const;
}
