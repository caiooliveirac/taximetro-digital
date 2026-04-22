import { z } from "zod/v4";
import { cancelCruFixedAssignments, materializeCruFixedAssignments } from "@/lib/cru-fixed";
import { localDateStr } from "@/lib/utils";
import { logAudit } from "@/shared/infra/logger/audit";
import { DOW, canManageCruFixed, type SchedulingActor } from "@/features/scheduling/application/use-cases/cru-fixed-shared";
import {
  deactivateCruFixedTemplateForFaculty,
  findCruFixedTemplate,
  findCruFixedTemplateByIdForFaculty,
  internBelongsToFaculty,
  upsertCruFixedTemplate,
} from "@/features/scheduling/infra/repositories/cru-fixed-repository";

export const addCruFixedSchema = z.object({
  internId: z.string().uuid(),
  dayOfWeek: z.enum(DOW),
  period: z.enum(["DAY", "NIGHT"]),
  weeks: z.number().int().min(1).max(24).default(6),
  /** IDs dos assignments conflitantes que o líder autorizou cancelar para liberar a CRU */
  forceConflictIds: z.array(z.string().uuid()).optional(),
});

export async function executeAddCruFixed(params: {
  actor: SchedulingActor;
  input: z.infer<typeof addCruFixedSchema>;
}) {
  const { actor, input } = params;

  if (!canManageCruFixed(actor)) {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }

  const belongs = await internBelongsToFaculty({
    internId: input.internId,
    facultyId: actor.facultyId!,
  });

  if (!belongs) {
    return { status: 400, body: { success: false, error: "Interno não pertence à sua faculdade" } } as const;
  }

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + input.weeks * 7);
  const validUntilStr = validUntil.toISOString().split("T")[0]!;

  try {
    const actorUserId = actor.realUserId ?? actor.id;

    const existing = await findCruFixedTemplate({
      internId: input.internId,
      dayOfWeek: input.dayOfWeek,
      period: input.period,
    });

    const templateId = await upsertCruFixedTemplate({
      existingId: existing?.id,
      internId: input.internId,
      facultyId: actor.facultyId!,
      dayOfWeek: input.dayOfWeek,
      period: input.period,
      createdBy: actorUserId,
      validUntil: validUntilStr,
    });

    const sync = await materializeCruFixedAssignments({
      facultyId: actor.facultyId!,
      startDate: localDateStr(),
      endDate: validUntilStr,
      actorUserId,
      templateIds: templateId ? [templateId] : undefined,
      forceConflictIds: input.forceConflictIds,
    });

    await logAudit({
      userId: actorUserId,
      action: "CRU_FIXED_ADD",
      entity: "cru_fixed_assignments",
      entityId: templateId ?? undefined,
      payload: {
        internId: input.internId,
        dayOfWeek: input.dayOfWeek,
        period: input.period,
        weeks: input.weeks,
        materialized: sync,
        ...(actor.isImpersonating ? { impersonating: actor.id, impersonateRole: actor.role } : {}),
      },
    });

    return { status: 200, body: { success: true, data: sync } } as const;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("uq_cru_fixed")) {
      return {
        status: 409,
        body: { success: false, error: "Interno já está cadastrado nesse dia/período" },
      } as const;
    }

    throw err;
  }
}

export async function executeRemoveCruFixed(params: {
  actor: SchedulingActor;
  id: string;
}) {
  const { actor, id } = params;

  if (!canManageCruFixed(actor)) {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }

  const current = await findCruFixedTemplateByIdForFaculty({
    id,
    facultyId: actor.facultyId!,
  });

  if (!current) {
    return { status: 404, body: { success: false, error: "Template CRU fixo não encontrado" } } as const;
  }

  await deactivateCruFixedTemplateForFaculty({
    id,
    facultyId: actor.facultyId!,
  });

  const cancelled = await cancelCruFixedAssignments({
    internId: current.internId,
    dayOfWeek: current.dayOfWeek,
    period: current.period,
    startDate: localDateStr(),
    endDate: current.validUntil,
  });

  await logAudit({
    userId: actor.realUserId ?? actor.id,
    action: "CRU_FIXED_REMOVE",
    entity: "cru_fixed_assignments",
    entityId: id,
    payload: {
      cancelled,
      ...(actor.isImpersonating ? { impersonating: actor.id, impersonateRole: actor.role } : {}),
    },
  });

  return { status: 200, body: { success: true, data: cancelled } } as const;
}
