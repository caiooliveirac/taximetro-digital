"use server";

import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { assignments, checkins } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getEffectiveUserFromContext } from "@/lib/impersonate";

const observationSchema = z.object({
  assignmentId: z.string().uuid(),
  observations: z.string().max(2000).optional(),
});

export type SaveObservationsResult =
  | { success: true; observations: string | null }
  | { success: false; error: string };

function normalizeObservation(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function saveObservationsAction(input: unknown): Promise<SaveObservationsResult> {
  const user = await getEffectiveUserFromContext();
  if (!user) return { success: false, error: "Não autenticado" };

  const parsed = observationSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const observations = normalizeObservation(parsed.data.observations);

  const [assignment] = await db
    .select({ id: assignments.id, status: assignments.status })
    .from(assignments)
    .where(and(eq(assignments.id, parsed.data.assignmentId), eq(assignments.internId, user.id)))
    .limit(1);

  if (!assignment) return { success: false, error: "Plantão não encontrado" };
  if (assignment.status !== "CHECKED_OUT") {
    return { success: false, error: "As observações ficam disponíveis somente após o checkout." };
  }

  const [checkin] = await db
    .select({ id: checkins.id })
    .from(checkins)
    .where(eq(checkins.assignmentId, assignment.id))
    .limit(1);

  if (!checkin) return { success: false, error: "Check-in não encontrado" };

  await db.update(checkins).set({ internObservations: observations }).where(eq(checkins.id, checkin.id));

  after(() =>
    logAudit({
      userId: user.realUserId ?? user.id,
      action: "INTERN_OBSERVATIONS_UPDATED",
      entity: "checkin",
      entityId: checkin.id,
      ...((user.isImpersonating || observations) ? {
        payload: {
          ...(user.isImpersonating ? { actingAs: user.id } : {}),
          ...(observations ? { hasObservations: true } : {}),
        },
      } : {}),
    }),
  );

  return { success: true, observations };
}
