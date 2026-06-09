import { z } from "zod/v4";
import { operationalDateStr } from "@/lib/utils";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  cancelAssignmentForSwap,
  createSwapAssignment,
  findAssignmentById,
  findRequestById,
  findUserNameById,
  hasCheckinRecord,
  updateRequestReview,
} from "@/features/requests/infra/repositories/request-repository";

export const authorizeSwapSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["authorize", "reject"]),
  notes: z.string().max(2000).optional(),
});

type AuthorizeActor = {
  id: string;
  role: string;
  realUserId: string | null;
};

function fmtDate(d: string) {
  // "YYYY-MM-DD" -> "DD/MM/YYYY"
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export async function executeAuthorizeSwap(params: {
  actor: AuthorizeActor;
  input: z.infer<typeof authorizeSwapSchema>;
}) {
  const { actor, input } = params;

  if (!["PRECEPTOR", "COORDINATOR"].includes(actor.role)) {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }

  const request = await findRequestById(input.id);
  if (!request) return { status: 404, body: { success: false, error: "Solicitação não encontrada" } } as const;
  if (request.type !== "SWAP") return { status: 400, body: { success: false, error: "Ação só permitida para trocas" } } as const;
  if (request.status !== "AWAITING_AUTH") {
    return { status: 409, body: { success: false, error: "Esta troca não está aguardando autorização" } } as const;
  }
  if (!request.assignmentId || !request.targetAssignmentId || !request.targetInternId) {
    return { status: 400, body: { success: false, error: "Troca incompleta" } } as const;
  }

  const preceptorId = actor.realUserId ?? actor.id;
  const reviewNotes = input.notes?.trim() || undefined;

  if (input.action === "reject") {
    await updateRequestReview({
      id: input.id,
      status: "CANCELLED",
      reviewedBy: preceptorId,
      reviewNotes: reviewNotes ?? "Troca recusada pelo preceptor",
    });

    await logAudit({
      userId: preceptorId,
      action: "REJECT_SWAP",
      entity: "request",
      entityId: input.id,
      payload: {
        requesterId: request.requesterId,
        targetInternId: request.targetInternId,
        reviewNotes,
      },
    });

    return { status: 200, body: { success: true } } as const;
  }

  // authorize → executa a troca atômica
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

  const requesterName = (await findUserNameById(origAssignment.internId)) ?? "interno";
  const targetName = (await findUserNameById(targetAssignment.internId)) ?? "interno";
  const preceptorName = (await findUserNameById(preceptorId)) ?? "preceptor";
  const authDateFmt = fmtDate(operationalDateStr());

  // Observações adicionais (notes) gravadas no plantão de cada interno:
  // com quem foi a troca e qual preceptor autorizou.
  const requesterNote = `Plantão obtido por troca com ${targetName} (cedeu ${fmtDate(origAssignment.date)}). Autorizada pelo preceptor ${preceptorName} em ${authDateFmt}.`;
  const targetNote = `Plantão obtido por troca com ${requesterName} (cedeu ${fmtDate(targetAssignment.date)}). Autorizada pelo preceptor ${preceptorName} em ${authDateFmt}.`;

  await cancelAssignmentForSwap(origAssignment.id);
  await cancelAssignmentForSwap(targetAssignment.id);

  // Requester passa a trabalhar o plantão do target
  await createSwapAssignment({
    internId: origAssignment.internId,
    facultyId: origAssignment.facultyId,
    baseId: targetAssignment.baseId,
    date: targetAssignment.date,
    period: targetAssignment.period,
    createdBy: preceptorId,
    notes: requesterNote,
  });

  // Target passa a trabalhar o plantão do requester
  await createSwapAssignment({
    internId: targetAssignment.internId,
    facultyId: targetAssignment.facultyId,
    baseId: origAssignment.baseId,
    date: origAssignment.date,
    period: origAssignment.period,
    createdBy: preceptorId,
    notes: targetNote,
  });

  await updateRequestReview({
    id: input.id,
    status: "COMPLETED",
    reviewedBy: preceptorId,
    reviewNotes: reviewNotes ?? `Troca autorizada pelo preceptor ${preceptorName}`,
  });

  await logAudit({
    userId: preceptorId,
    action: "AUTHORIZE_SWAP",
    entity: "request",
    entityId: input.id,
    payload: {
      requesterId: origAssignment.internId,
      targetInternId: targetAssignment.internId,
      origAssignmentId: origAssignment.id,
      targetAssignmentId: targetAssignment.id,
      preceptorId,
      reviewNotes,
    },
  });

  return { status: 200, body: { success: true } } as const;
}
