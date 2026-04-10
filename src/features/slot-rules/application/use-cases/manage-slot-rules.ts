import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  createSlotRule,
  listSlotRules,
  softDeleteSlotRule,
  updateSlotRuleById,
} from "@/features/slot-rules/infra/repositories/slot-rule-repository";

export const slotRuleSchema = z.object({
  baseId: z.string().uuid(),
  dayOfWeek: z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]),
  period: z.enum(["DAY", "NIGHT"]),
  facultyId: z.string().uuid(),
  capacity: z.number().int().min(0).max(20).default(1),
  isActive: z.boolean().default(true),
  isExtraShift: z.boolean().default(false),
});

export async function executeListSlotRules() {
  return listSlotRules();
}

export async function executeCreateSlotRule(params: {
  actorUserId: string;
  input: z.infer<typeof slotRuleSchema>;
}) {
  const created = await createSlotRule(params.input);

  await logAudit({
    userId: params.actorUserId,
    action: "CREATE_SLOT_RULE",
    entity: "slot_rule",
    entityId: created.id,
    payload: params.input,
  });

  return { status: 201, body: { success: true, data: created } } as const;
}

export async function executeUpdateSlotRule(params: {
  actorUserId: string;
  ruleId: string;
  input: Partial<z.infer<typeof slotRuleSchema>>;
}) {
  const updated = await updateSlotRuleById({ id: params.ruleId, values: params.input });
  if (!updated) return { status: 404, body: { success: false, error: "Regra não encontrada" } } as const;

  await logAudit({
    userId: params.actorUserId,
    action: "UPDATE_SLOT_RULE",
    entity: "slot_rule",
    entityId: params.ruleId,
    payload: params.input,
  });

  return { status: 200, body: { success: true, data: updated } } as const;
}

export async function executeDeleteSlotRule(params: {
  actorUserId: string;
  ruleId: string;
}) {
  const deleted = await softDeleteSlotRule(params.ruleId);
  if (!deleted) return { status: 404, body: { success: false, error: "Regra não encontrada" } } as const;

  await logAudit({
    userId: params.actorUserId,
    action: "DELETE_SLOT_RULE",
    entity: "slot_rule",
    entityId: params.ruleId,
  });

  return { status: 200, body: { success: true } } as const;
}
