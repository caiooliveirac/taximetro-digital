import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  findPhotoChangeRequestForReview,
  reviewPhotoChangeRequest,
} from "@/features/user-management/infra/repositories/user-management-repository";

export const reviewPendingPhotoChangeRequestSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  reviewNotes: z.string().trim().max(500).optional(),
});

type Actor = {
  id: string;
  role: string;
  facultyId: string | null;
  realUserId: string | null;
};

export async function executeReviewPendingPhotoChangeRequest(params: {
  actor: Actor;
  input: z.infer<typeof reviewPendingPhotoChangeRequestSchema>;
}) {
  const { actor, input } = params;

  const request = await findPhotoChangeRequestForReview(input.requestId);
  if (!request) {
    return { status: 404, body: { success: false, error: "Solicitação não encontrada" } } as const;
  }

  if (actor.role === "LEADER" && request.facultyId !== actor.facultyId) {
    return { status: 403, body: { success: false, error: "Sem permissão para esta solicitação" } } as const;
  }

  if (request.status !== "PENDING") {
    return { status: 409, body: { success: false, error: "Esta solicitação já foi analisada" } } as const;
  }

  await reviewPhotoChangeRequest({
    requestId: input.requestId,
    status: input.action === "approve" ? "APPROVED" : "REJECTED",
    reviewedBy: actor.id,
    reviewNotes: input.reviewNotes,
  });

  await logAudit({
    userId: actor.realUserId ?? actor.id,
    action: input.action === "approve" ? "APPROVE_PHOTO_CHANGE_REQUEST" : "REJECT_PHOTO_CHANGE_REQUEST",
    entity: "user_photo_change_request",
    entityId: input.requestId,
    payload: { requestUserId: request.userId },
  });

  return { status: 200, body: { success: true } } as const;
}