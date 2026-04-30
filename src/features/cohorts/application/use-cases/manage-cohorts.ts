import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  listCohorts,
  getCohortById,
  createCohort,
  updateCohort,
  deleteCohort,
} from "@/features/cohorts/infra/repositories/cohort-repository";

export const cohortCreateSchema = z.object({
  facultyId: z.string().uuid(),
  rotationNumber: z.number().int().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().min(1).max(255),
  notes: z.string().optional(),
});

export const cohortUpdateSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  label: z.string().min(1).max(255).optional(),
  status: z.enum(["PLANNED", "ACTIVE", "CLOSED"]).optional(),
  notes: z.string().optional(),
});

export async function executeListCohorts(filters?: {
  facultyId?: string;
  status?: ("PLANNED" | "ACTIVE" | "CLOSED")[];
}) {
  return listCohorts(filters);
}

export async function executeGetCohort(id: string) {
  return getCohortById(id);
}

export async function executeCreateCohort(params: {
  actorUserId: string;
  input: z.infer<typeof cohortCreateSchema>;
}) {
  if (params.input.endDate < params.input.startDate) {
    return { status: 400, body: { success: false, error: "endDate deve ser >= startDate" } } as const;
  }

  const created = await createCohort({ ...params.input, createdBy: params.actorUserId });

  await logAudit({
    userId: params.actorUserId,
    action: "CREATE_COHORT",
    entity: "cohort",
    entityId: created.id,
    payload: params.input,
  });

  return { status: 201, body: { success: true, data: created } } as const;
}

export async function executeUpdateCohort(params: {
  actorUserId: string;
  cohortId: string;
  input: z.infer<typeof cohortUpdateSchema>;
}) {
  const existing = await getCohortById(params.cohortId);
  if (!existing) {
    return { status: 404, body: { success: false, error: "Turma não encontrada" } } as const;
  }

  if (existing.status === "CLOSED") {
    return { status: 409, body: { success: false, error: "Turma fechada não pode ser editada" } } as const;
  }

  const startDate = params.input.startDate ?? existing.startDate;
  const endDate = params.input.endDate ?? existing.endDate;
  if (endDate < startDate) {
    return { status: 400, body: { success: false, error: "endDate deve ser >= startDate" } } as const;
  }

  const updated = await updateCohort(params.cohortId, params.input);

  await logAudit({
    userId: params.actorUserId,
    action: "UPDATE_COHORT",
    entity: "cohort",
    entityId: params.cohortId,
    payload: params.input,
  });

  return { status: 200, body: { success: true, data: updated } } as const;
}

export async function executeDeleteCohort(params: {
  actorUserId: string;
  cohortId: string;
}) {
  const existing = await getCohortById(params.cohortId);
  if (!existing) {
    return { status: 404, body: { success: false, error: "Turma não encontrada" } } as const;
  }

  if (existing.status !== "PLANNED") {
    return { status: 409, body: { success: false, error: "Só turmas com status PLANNED podem ser excluídas" } } as const;
  }

  await deleteCohort(params.cohortId);

  await logAudit({
    userId: params.actorUserId,
    action: "DELETE_COHORT",
    entity: "cohort",
    entityId: params.cohortId,
    payload: {},
  });

  return { status: 200, body: { success: true } } as const;
}
