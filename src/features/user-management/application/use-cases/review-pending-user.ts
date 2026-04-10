import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  approvePendingUser,
  findUserRoleFaculty,
  rejectPendingUser,
} from "@/features/user-management/infra/repositories/user-management-repository";

export const reviewPendingUserSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
});

type Actor = {
  id: string;
  role: string;
  facultyId: string | null;
  realUserId: string | null;
};

export async function executeReviewPendingUser(params: {
  actor: Actor;
  input: z.infer<typeof reviewPendingUserSchema>;
}) {
  const { actor, input } = params;

  if (actor.role === "LEADER") {
    const role = await findUserRoleFaculty(input.userId);
    if (!role || role.facultyId !== actor.facultyId) {
      return { status: 403, body: { success: false, error: "Sem permissão para este usuário" } } as const;
    }
  }

  if (input.action === "approve") {
    await approvePendingUser(input.userId);
  } else {
    await rejectPendingUser(input.userId);
  }

  await logAudit({
    userId: actor.realUserId ?? actor.id,
    action: input.action === "approve" ? "APPROVE_USER" : "REJECT_USER",
    entity: "user",
    entityId: input.userId,
  });

  return { status: 200, body: { success: true } } as const;
}
