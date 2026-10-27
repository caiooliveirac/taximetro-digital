import {
  createApprovedExtraAssignment,
  findBaseAvailability,
  findExistingAssignmentForInternSlot,
  findRequestById,
  findRequesterFacultyRole,
  reactivateCancelledAssignment,
  updateRequestReview,
} from "@/features/requests/infra/repositories/request-repository";
import { logAudit } from "@/shared/infra/logger/audit";
import { checkPeriodOccupancy } from "@/lib/slots";
import { executeClaimExtraOffer } from "@/features/extra-offers/application/use-cases/claim-extra-offer";

type ReviewActor = {
  id: string;
  role: string;
  facultyId: string | null;
  isImpersonating: boolean;
  realUserId: string | null;
};

export async function executeReviewRequest(params: {
  actor: ReviewActor;
  input: {
    id?: string;
    status?: string;
    reviewNotes?: string;
  };
}) {
  const { actor, input } = params;

  if (!input.id || !input.status || !["APPROVED", "REJECTED", "ESCALATED"].includes(input.status)) {
    return { status: 400, body: { success: false, error: "Dados inválidos" } } as const;
  }

  const request = await findRequestById(input.id);
  if (!request) return { status: 404, body: { success: false, error: "Solicitação não encontrada" } } as const;

  if (request.type === "SWAP") {
    return { status: 400, body: { success: false, error: "Trocas são auto-geridas entre internos" } } as const;
  }

  if (request.status !== "PENDING" && request.status !== "ESCALATED") {
    return {
      status: 409,
      body: { success: false, error: `Solicitação já processada (${request.status})` },
    } as const;
  }

  // Vaga livre acima da meta: o pedido é do líder, a decisão é só da coordenação.
  if (request.type === "FREE_SLOT" && actor.role !== "COORDINATOR") {
    return { status: 403, body: { success: false, error: "Só a coordenação aprova vaga livre acima da meta" } } as const;
  }

  if (actor.role === "LEADER" && actor.facultyId) {
    const reqRole = await findRequesterFacultyRole(request.requesterId);
    if (!reqRole || reqRole.facultyId !== actor.facultyId) {
      return { status: 403, body: { success: false, error: "Sem permissão para analisar esta solicitação" } } as const;
    }
  }

  let finalStatus = input.status;

  try {
    if (input.status === "APPROVED") {
      if (request.type === "EXTRA_SHIFT") {
        if (!request.extraBaseId || !request.extraDate || !request.extraPeriod) {
          return {
            status: 400,
            body: { success: false, error: "Solicitação de plantão extra está incompleta" },
          } as const;
        }

        const extraBaseRow = await findBaseAvailability(request.extraBaseId);
        if (!extraBaseRow || !extraBaseRow.isActive) {
          return {
            status: 400,
            body: { success: false, error: "Base do plantão extra não está disponível" },
          } as const;
        }

        const reqRole = await findRequesterFacultyRole(request.requesterId);
        if (!reqRole?.facultyId) {
          return { status: 400, body: { success: false, error: "Usuário sem faculdade vinculada" } } as const;
        }

        // A vaga foi checada quando o interno pediu; entre pedido e aprovação a
        // base pode ter lotado. O plantão gravado aqui conta como plantão normal,
        // então tem que respeitar o mesmo teto.
        const load = await checkPeriodOccupancy(
          request.extraBaseId,
          request.extraDate,
          request.extraPeriod as "DAY" | "NIGHT",
        );
        if (load.full) {
          return {
            status: 409,
            body: {
              success: false,
              error: `Base já está com ${load.occupied} internos neste turno (limite ${load.limit}). Não dá para aprovar o extra.`,
            },
          } as const;
        }

        const existingAssignment = await findExistingAssignmentForInternSlot({
          internId: request.requesterId,
          date: request.extraDate,
          period: request.extraPeriod as "DAY" | "NIGHT",
        });

        if (existingAssignment?.status === "CANCELLED") {
          await reactivateCancelledAssignment({
            assignmentId: existingAssignment.id,
            facultyId: reqRole.facultyId,
            baseId: request.extraBaseId,
            updatedBy: actor.realUserId ?? actor.id,
          });
        } else if (existingAssignment) {
          return {
            status: 409,
            body: { success: false, error: "O interno já possui plantão ativo nessa data e turno" },
          } as const;
        } else {
          await createApprovedExtraAssignment({
            requesterId: request.requesterId,
            facultyId: reqRole.facultyId,
            baseId: request.extraBaseId,
            date: request.extraDate,
            period: request.extraPeriod as "DAY" | "NIGHT",
            createdBy: actor.realUserId ?? actor.id,
          });
        }

        finalStatus = "COMPLETED";
      }

      if (request.type === "FREE_SLOT") {
        if (!request.extraOfferId || !request.targetInternId) {
          return { status: 400, body: { success: false, error: "Pedido de vaga livre incompleto" } } as const;
        }
        const internRole = await findRequesterFacultyRole(request.targetInternId);
        // Mesmo caminho do líder, como coordenação: sem trava de meta, e o
        // plantão fica no nome do líder que pediu (é ele no KPI do cockpit).
        const claim = await executeClaimExtraOffer({
          actor: { id: actor.realUserId ?? actor.id, role: "COORDINATOR", facultyId: null },
          offerId: request.extraOfferId,
          internId: request.targetInternId,
          facultyId: internRole?.facultyId ?? undefined,
          createdBy: request.requesterId,
        });
        if (claim.status !== 200) return claim;
        finalStatus = "COMPLETED";
      }
    }

    const updated = await updateRequestReview({
      id: input.id,
      status: finalStatus,
      reviewedBy: actor.realUserId ?? actor.id,
      reviewNotes: input.reviewNotes,
    });

    await logAudit({
      userId: actor.realUserId ?? actor.id,
      action: `REVIEW_REQUEST_${input.status}`,
      entity: "request",
      entityId: input.id,
      payload: {
        status: finalStatus,
        reviewNotes: input.reviewNotes,
        ...(actor.isImpersonating ? { impersonating: actor.id, impersonateRole: actor.role } : {}),
      },
    });

    return { status: 200, body: { success: true, data: updated } } as const;
  } catch (err: unknown) {
    const cause = typeof err === "object" && err !== null && "cause" in err
      ? (err as { cause?: { code?: string } }).cause
      : undefined;
    const code = cause?.code;

    if (code === "23502") {
      return { status: 400, body: { success: false, error: "Dados incompletos ao tentar alocar o plantão extra" } } as const;
    }
    if (code === "23503") {
      return { status: 400, body: { success: false, error: "Dados de vínculo inválidos para criar o plantão extra" } } as const;
    }
    if (code === "23505") {
      return { status: 409, body: { success: false, error: "O interno já possui plantão nessa data e turno" } } as const;
    }

    throw err;
  }
}
