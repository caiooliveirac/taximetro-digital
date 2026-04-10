import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  updateInternArchiveStatus,
  updateInternRoleActiveStatus,
} from "@/features/user-management/infra/repositories/user-management-repository";

export const updateInternStatusSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(["deactivate", "reactivate", "archive", "unarchive"]),
});

type Actor = {
  id: string;
  facultyId: string;
  isImpersonating: boolean;
  realUserId: string | null;
};

export async function executeUpdateInternStatus(params: {
  actor: Actor;
  input: z.infer<typeof updateInternStatusSchema>;
}) {
  const { actor, input } = params;
  const actorId = actor.realUserId ?? actor.id;

  if (input.action === "archive" || input.action === "unarchive") {
    const isArchived = input.action === "archive";
    await updateInternArchiveStatus({
      userId: input.userId,
      facultyId: actor.facultyId,
      isArchived,
      archivedBy: isArchived ? actorId : null,
    });

    await logAudit({
      userId: actorId,
      action: isArchived ? "ARCHIVE_INTERN" : "UNARCHIVE_INTERN",
      entity: "user_role",
      entityId: input.userId,
      payload: { facultyId: actor.facultyId, ...(actor.isImpersonating ? { impersonating: actor.id } : {}) },
    });

    return { status: 200, body: { success: true } } as const;
  }

  const newActive = input.action === "reactivate";
  await updateInternRoleActiveStatus({
    userId: input.userId,
    facultyId: actor.facultyId,
    isActive: newActive,
  });

  await logAudit({
    userId: actorId,
    action: input.action === "deactivate" ? "DEACTIVATE_INTERN" : "REACTIVATE_INTERN",
    entity: "user_role",
    entityId: input.userId,
    payload: { facultyId: actor.facultyId, ...(actor.isImpersonating ? { impersonating: actor.id } : {}) },
  });

  return { status: 200, body: { success: true } } as const;
}
