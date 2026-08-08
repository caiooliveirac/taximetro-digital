import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import { checkCruConflict, checkPeriodOccupancy } from "@/lib/slots";
import {
  findAssignmentForReassign,
  findBaseForReassign,
  updateAssignmentBaseAndNotes,
} from "@/features/scheduling/infra/repositories/assignment-query-repository";

export const reassignAssignmentSchema = z.object({
  assignmentId: z.string().uuid(),
  newBaseId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
  authorized: z.literal(true),
});

type Actor = {
  id: string;
  role: string;
  facultyId: string | null;
  isImpersonating: boolean;
  realUserId: string | null;
};

export async function executeReassignAssignmentBase(params: {
  actor: Actor;
  input: z.infer<typeof reassignAssignmentSchema>;
}) {
  const { actor, input } = params;
  const { assignmentId, newBaseId, reason } = input;

  const assignment = await findAssignmentForReassign(assignmentId);
  if (!assignment) return { status: 404, body: { success: false, error: "Plantão não encontrado" } } as const;

  if (actor.role === "LEADER" && actor.facultyId !== assignment.facultyId) {
    return { status: 403, body: { success: false, error: "Plantão não pertence à sua faculdade" } } as const;
  }

  if (["CHECKED_OUT", "ABSENT", "CANCELLED"].includes(assignment.status)) {
    return { status: 409, body: { success: false, error: "Este plantão não pode mais ser remanejado" } } as const;
  }

  if (assignment.baseId === newBaseId) {
    return { status: 409, body: { success: false, error: "O interno já está alocado nesta base" } } as const;
  }

  if (assignment.status === "CHECKED_IN" && !reason) {
    return {
      status: 400,
      body: { success: false, error: "Informe o motivo do remanejamento excepcional após check-in validado" },
    } as const;
  }

  const targetBase = await findBaseForReassign(newBaseId);
  if (!targetBase || !targetBase.isActive) {
    return { status: 404, body: { success: false, error: "Base de destino inválida" } } as const;
  }

  // Remanejar não podia estourar a base de destino: era o caminho mais curto
  // para três internos no mesmo turno.
  if (!assignment.isExtraShift) {
    const load = await checkPeriodOccupancy(
      targetBase.id,
      assignment.date,
      assignment.period as "DAY" | "NIGHT",
      assignment.shift,
      assignment.id,
    );
    if (load.full) {
      return {
        status: 409,
        body: {
          success: false,
          error: `Base de destino já está com ${load.occupied} internos neste turno (limite ${load.limit}). Libere lugar antes de remanejar.`,
        },
      } as const;
    }
  }

  if (["CENTRAL", "CRL"].includes(targetBase.type)) {
    const cruConflict = await checkCruConflict(
      assignment.internId,
      assignment.date,
      assignment.period as "DAY" | "NIGHT",
      assignment.id,
    );
    if (cruConflict.conflicted) {
      return { status: 409, body: { success: false, error: cruConflict.reason ?? "Conflito com regulação" } } as const;
    }
  }

  const noteLines = assignment.notes ? [assignment.notes] : [];
  noteLines.push(`[REMANEJADO] ${assignment.currentBaseCode} -> ${targetBase.code}${reason ? ` | ${reason}` : ""}`);

  const updated = await updateAssignmentBaseAndNotes({
    assignmentId: assignment.id,
    baseId: targetBase.id,
    notes: noteLines.length > 0 ? noteLines.join("\n") : null,
  });

  await logAudit({
    userId: actor.realUserId ?? actor.id,
    action: "REASSIGN_ASSIGNMENT_BASE",
    entity: "assignment",
    entityId: assignment.id,
    payload: {
      previousBaseId: assignment.baseId,
      previousBaseCode: assignment.currentBaseCode,
      previousBaseName: assignment.currentBaseName,
      previousBaseType: assignment.currentBaseType,
      newBaseId: targetBase.id,
      newBaseCode: targetBase.code,
      newBaseName: targetBase.name,
      newBaseType: targetBase.type,
      assignmentDate: assignment.date,
      assignmentPeriod: assignment.period,
      assignmentStatus: assignment.status,
      checkinStatus: assignment.checkinStatus,
      authorized: true,
      reason: reason ?? null,
      ...(actor.isImpersonating ? { impersonating: actor.id, impersonateRole: actor.role } : {}),
    },
  });

  return { status: 200, body: { success: true, data: updated } } as const;
}
