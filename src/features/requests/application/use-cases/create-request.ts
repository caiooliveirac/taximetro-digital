import { z } from "zod/v4";
import { checkCruConflict, checkSlotAvailability } from "@/lib/slots";
import { operationalDateStr } from "@/lib/utils";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  findAssignmentOwnerBasic,
  findExistingAssignmentForInternSlot,
  findPendingExtraRequest,
  findPendingRequestByAssignment,
  findRequesterFacultyRole,
  insertRequest,
} from "@/features/requests/infra/repositories/request-repository";

const swapSchema = z.object({
  type: z.literal("SWAP"),
  assignmentId: z.string().uuid(),
});

const extraShiftSchema = z.object({
  type: z.literal("EXTRA_SHIFT"),
  extraBaseId: z.string().uuid(),
  extraDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  extraPeriod: z.enum(["DAY", "NIGHT"]),
});

export const createRequestSchema = z.discriminatedUnion("type", [swapSchema, extraShiftSchema]);

export function getRequestValidationError(error: z.ZodError): string {
  const extraDateIssue = error.issues.find((issue) => issue.path.join(".") === "extraDate");
  if (extraDateIssue) return "Data do plantão extra é obrigatória";

  const extraBaseIssue = error.issues.find((issue) => issue.path.join(".") === "extraBaseId");
  if (extraBaseIssue) return "Base do plantão extra é obrigatória";

  const extraPeriodIssue = error.issues.find((issue) => issue.path.join(".") === "extraPeriod");
  if (extraPeriodIssue) return "Turno do plantão extra é obrigatório";

  return error.message;
}

type RequestActor = {
  id: string;
  role: string;
  isImpersonating: boolean;
  realUserId: string | null;
};

export async function executeCreateRequest(params: {
  actor: RequestActor;
  input: z.infer<typeof createRequestSchema>;
  onBehalfOf?: string;
}) {
  const { actor, input, onBehalfOf } = params;
  const requesterId = (typeof onBehalfOf === "string" && ["COORDINATOR", "LEADER"].includes(actor.role)) ? onBehalfOf : actor.id;
  const todayStr = operationalDateStr();

  if (input.type === "SWAP") {
    const ownerAssignment = await findAssignmentOwnerBasic(input.assignmentId);

    if (!ownerAssignment) return { status: 404, body: { success: false, error: "Plantão não encontrado" } } as const;
    if (ownerAssignment.internId !== requesterId) return { status: 403, body: { success: false, error: "Esse plantão não pertence a você" } } as const;
    if (ownerAssignment.isExtraShift) return { status: 400, body: { success: false, error: "Plantões extras não podem ser trocados" } } as const;
    if (ownerAssignment.date < todayStr) return { status: 400, body: { success: false, error: "Não é possível solicitar alteração de plantão passado" } } as const;
    if (!["SCHEDULED", "CONFIRMED"].includes(ownerAssignment.status)) {
      return {
        status: 400,
        body: { success: false, error: `Plantão com status '${ownerAssignment.status}' não pode ser alterado` },
      } as const;
    }

    const existingReq = await findPendingRequestByAssignment(input.assignmentId);
    if (existingReq) {
      return {
        status: 409,
        body: { success: false, error: "Já existe uma solicitação pendente para este plantão" },
      } as const;
    }
  }

  if (input.type === "EXTRA_SHIFT") {
    if (input.extraDate < todayStr) {
      return { status: 400, body: { success: false, error: "Data do plantão extra deve ser futura" } } as const;
    }

    const reqRole = await findRequesterFacultyRole(requesterId);
    if (!reqRole?.facultyId) {
      return { status: 400, body: { success: false, error: "Usuário sem faculdade vinculada" } } as const;
    }

    const existingAssignment = await findExistingAssignmentForInternSlot({
      internId: requesterId,
      date: input.extraDate,
      period: input.extraPeriod,
    });

    if (existingAssignment && existingAssignment.status !== "CANCELLED") {
      return { status: 409, body: { success: false, error: "Você já possui plantão nessa data e turno" } } as const;
    }

    const slot = await checkSlotAvailability(input.extraBaseId, input.extraDate, input.extraPeriod, reqRole.facultyId);
    if (!slot.available) {
      return {
        status: 409,
        body: { success: false, error: `Sem vaga disponível (${slot.assigned}/${slot.capacity})` },
      } as const;
    }

    const cruCheck = await checkCruConflict(requesterId, input.extraDate, input.extraPeriod);
    if (cruCheck.conflicted) {
      return {
        status: 409,
        body: { success: false, error: cruCheck.reason ?? "Conflito com plantão em regulação" },
      } as const;
    }

    const existingReq = await findPendingExtraRequest({
      requesterId,
      extraDate: input.extraDate,
      extraPeriod: input.extraPeriod,
    });

    if (existingReq) {
      return {
        status: 409,
        body: { success: false, error: "Já existe solicitação pendente de extra para essa data e turno" },
      } as const;
    }
  }

  const insertData = {
    type: input.type,
    requesterId,
    assignmentId: input.type !== "EXTRA_SHIFT" ? input.assignmentId : null,
    targetInternId: null,
    targetAssignmentId: null,
    extraBaseId: input.type === "EXTRA_SHIFT" ? input.extraBaseId : null,
    extraDate: input.type === "EXTRA_SHIFT" ? input.extraDate : null,
    extraPeriod: input.type === "EXTRA_SHIFT" ? input.extraPeriod : null,
    status: input.type === "SWAP" ? ("OPEN" as const) : ("PENDING" as const),
  };

  const created = await insertRequest(insertData);

  await logAudit({
    userId: actor.realUserId ?? actor.id,
    action: "CREATE_REQUEST",
    entity: "request",
    entityId: created.id,
    payload: {
      ...input,
      requesterId,
      ...(actor.isImpersonating ? { impersonating: actor.id, impersonateRole: actor.role } : {}),
    },
  });

  return { status: 201, body: { success: true, data: created } } as const;
}
