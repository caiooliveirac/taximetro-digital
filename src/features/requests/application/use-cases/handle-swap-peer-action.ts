import { z } from "zod/v4";
import { operationalDateStr } from "@/lib/utils";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  cancelAssignmentForSwap,
  cancelOpenSwapRequest,
  completeSwapRequest,
  createSwapAssignment,
  findAssignmentById,
  findAssignmentWithOwnership,
  findInternFacultiesByUserId,
  findPendingRequestByAssignment,
  findRequestById,
  hasCheckinRecord,
  reopenSwapRequest,
  updateRequestProposal,
} from "@/features/requests/infra/repositories/request-repository";

export const swapPeerActionSchema = z.discriminatedUnion("action", [
  z.object({ id: z.string().uuid(), action: z.literal("propose"), assignmentId: z.string().uuid() }),
  z.object({ id: z.string().uuid(), action: z.literal("confirm") }),
  z.object({ id: z.string().uuid(), action: z.literal("reject_proposal") }),
  z.object({ id: z.string().uuid(), action: z.literal("cancel") }),
  z.object({ id: z.string().uuid(), action: z.literal("withdraw_proposal") }),
]);

type SwapActor = {
  id: string;
  realUserId: string | null;
};

export async function executeSwapPeerAction(params: {
  actor: SwapActor;
  input: z.infer<typeof swapPeerActionSchema>;
}) {
  const { actor, input } = params;
  const userId = actor.id;

  const request = await findRequestById(input.id);
  if (!request) return { status: 404, body: { success: false, error: "Solicitação não encontrada" } } as const;
  if (request.type !== "SWAP") return { status: 400, body: { success: false, error: "Ação só permitida para trocas" } } as const;

  if (input.action === "propose") {
    if (request.status !== "OPEN") {
      return { status: 400, body: { success: false, error: "Esta troca não está aberta para propostas" } } as const;
    }
    if (request.requesterId === userId) {
      return { status: 400, body: { success: false, error: "Não é possível propor troca consigo mesmo" } } as const;
    }

    const proposerAssignment = await findAssignmentWithOwnership(input.assignmentId);
    if (!proposerAssignment) return { status: 404, body: { success: false, error: "Plantão não encontrado" } } as const;
    if (proposerAssignment.internId !== userId) {
      return { status: 403, body: { success: false, error: "Esse plantão não pertence a você" } } as const;
    }
    if (!["SCHEDULED", "CONFIRMED"].includes(proposerAssignment.status)) {
      return { status: 400, body: { success: false, error: "Plantão não pode ser trocado" } } as const;
    }

    const todayStr = operationalDateStr();
    if (proposerAssignment.date < todayStr) {
      return { status: 400, body: { success: false, error: "Plantão já passou" } } as const;
    }

    const requesterFaculties = await findInternFacultiesByUserId(request.requesterId);
    const proposerFaculties = await findInternFacultiesByUserId(userId);
    const sharesFaculty = [...proposerFaculties].some((id) => requesterFaculties.has(id));
    if (!sharesFaculty) {
      return { status: 400, body: { success: false, error: "Troca só é permitida dentro da mesma faculdade" } } as const;
    }

    const existingReq = await findPendingRequestByAssignment(input.assignmentId);
    if (existingReq) {
      return {
        status: 409,
        body: { success: false, error: "Seu plantão já está envolvido em outra solicitação pendente" },
      } as const;
    }

    await updateRequestProposal({
      requestId: input.id,
      targetInternId: userId,
      targetAssignmentId: input.assignmentId,
    });

    await logAudit({
      userId: actor.realUserId ?? actor.id,
      action: "PROPOSE_SWAP",
      entity: "request",
      entityId: input.id,
      payload: { assignmentId: input.assignmentId },
    });

    return { status: 200, body: { success: true } } as const;
  }

  if (input.action === "confirm") {
    if (request.requesterId !== userId) {
      return { status: 403, body: { success: false, error: "Só o solicitante pode confirmar" } } as const;
    }
    if (request.status !== "PENDING") {
      return { status: 400, body: { success: false, error: "Nenhuma proposta para confirmar" } } as const;
    }
    if (!request.targetAssignmentId || !request.targetInternId || !request.assignmentId) {
      return { status: 400, body: { success: false, error: "Proposta incompleta" } } as const;
    }

    const origAssignment = await findAssignmentById(request.assignmentId);
    const targetAssignment = await findAssignmentById(request.targetAssignmentId);

    if (!origAssignment || !targetAssignment) {
      return { status: 404, body: { success: false, error: "Plantões não encontrados" } } as const;
    }
    if (!["SCHEDULED", "CONFIRMED"].includes(origAssignment.status) || !["SCHEDULED", "CONFIRMED"].includes(targetAssignment.status)) {
      return { status: 409, body: { success: false, error: "Um dos plantões já foi alterado" } } as const;
    }

    const origHasCheckin = await hasCheckinRecord(origAssignment.id);
    const targetHasCheckin = await hasCheckinRecord(targetAssignment.id);
    if (origHasCheckin || targetHasCheckin) {
      return { status: 409, body: { success: false, error: "Um dos plantões já possui check-in" } } as const;
    }

    await cancelAssignmentForSwap(origAssignment.id);
    await cancelAssignmentForSwap(targetAssignment.id);

    await createSwapAssignment({
      internId: origAssignment.internId,
      facultyId: origAssignment.facultyId,
      baseId: targetAssignment.baseId,
      date: targetAssignment.date,
      period: targetAssignment.period,
      createdBy: actor.realUserId ?? actor.id,
    });

    await createSwapAssignment({
      internId: targetAssignment.internId,
      facultyId: targetAssignment.facultyId,
      baseId: origAssignment.baseId,
      date: origAssignment.date,
      period: origAssignment.period,
      createdBy: actor.realUserId ?? actor.id,
    });

    await completeSwapRequest(input.id);

    await logAudit({
      userId: actor.realUserId ?? actor.id,
      action: "CONFIRM_SWAP",
      entity: "request",
      entityId: input.id,
      payload: {
        origAssignmentId: origAssignment.id,
        targetAssignmentId: targetAssignment.id,
      },
    });

    return { status: 200, body: { success: true } } as const;
  }

  if (input.action === "reject_proposal") {
    if (request.requesterId !== userId) {
      return { status: 403, body: { success: false, error: "Só o solicitante pode rejeitar propostas" } } as const;
    }
    if (request.status !== "PENDING") {
      return { status: 400, body: { success: false, error: "Nenhuma proposta para rejeitar" } } as const;
    }

    await reopenSwapRequest(input.id);

    await logAudit({
      userId: actor.realUserId ?? actor.id,
      action: "REJECT_SWAP_PROPOSAL",
      entity: "request",
      entityId: input.id,
      payload: {},
    });

    return { status: 200, body: { success: true } } as const;
  }

  if (input.action === "cancel") {
    const isRequester = request.requesterId === userId;
    const isTarget = request.targetInternId === userId;
    if (!isRequester && !isTarget) {
      return { status: 403, body: { success: false, error: "Você não participa desta troca" } } as const;
    }
    if (!["OPEN", "PENDING"].includes(request.status)) {
      return { status: 400, body: { success: false, error: "Não é possível cancelar neste estado" } } as const;
    }

    await cancelOpenSwapRequest(input.id);

    await logAudit({
      userId: actor.realUserId ?? actor.id,
      action: "CANCEL_REQUEST",
      entity: "request",
      entityId: input.id,
      payload: { cancelledBy: isRequester ? "requester" : "target" },
    });

    return { status: 200, body: { success: true } } as const;
  }

  if (input.action === "withdraw_proposal") {
    if (request.targetInternId !== userId) {
      return { status: 403, body: { success: false, error: "Só quem propôs pode desistir da proposta" } } as const;
    }
    if (request.status !== "PENDING") {
      return { status: 400, body: { success: false, error: "Nenhuma proposta para retirar" } } as const;
    }

    await reopenSwapRequest(input.id);

    await logAudit({
      userId: actor.realUserId ?? actor.id,
      action: "WITHDRAW_SWAP_PROPOSAL",
      entity: "request",
      entityId: input.id,
      payload: {},
    });

    return { status: 200, body: { success: true } } as const;
  }

  return { status: 400, body: { success: false, error: "Ação inválida" } } as const;
}
