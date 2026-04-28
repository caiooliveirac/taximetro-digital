import { z } from "zod/v4";
import {
  insertExtraOffer,
} from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import { logAudit } from "@/shared/infra/logger/audit";

function normalizeDateInput(value: string) {
  const trimmed = value.trim();
  const ymd = trimmed.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (ymd) return ymd;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toISOString().slice(0, 10);
}

export const publishExtraOfferSchema = z.object({
  baseId: z.string().uuid(),
  date: z
    .string()
    .transform((value) => normalizeDateInput(value))
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  period: z.enum(["DAY", "NIGHT"]),
  shift: z.enum(["MORNING", "AFTERNOON"]).nullish(),
  facultyId: z
    .union([z.string().uuid(), z.literal(""), z.null()])
    .optional()
    .transform((value) => (value === "" ? null : value ?? null)),
  notes: z.string().max(500).nullish(),
});

export async function executePublishExtraOffer(params: {
  actor: { id: string; role: string; facultyId: string | null };
  input: z.infer<typeof publishExtraOfferSchema>;
}) {
  const { actor, input } = params;

  if (!["COORDINATOR", "LEADER"].includes(actor.role)) {
    return { status: 403, body: { success: false, error: "Sem permissão para publicar extras" } } as const;
  }

  const offer = await insertExtraOffer({
    baseId: input.baseId,
    date: input.date,
    period: input.period,
    shift: input.shift ?? null,
    facultyId: input.facultyId ?? null,
    notes: input.notes ?? null,
    publishedBy: actor.id,
  });

  await logAudit({
    userId: actor.id,
    action: "extra_offer.published",
    entity: "extra_shift_offers",
    entityId: offer.id,
    payload: { baseId: input.baseId, date: input.date, period: input.period },
  });

  return { status: 201, body: { success: true, data: offer } } as const;
}
