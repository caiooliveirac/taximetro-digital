import { db } from "@/shared/db/client";
import { eq } from "drizzle-orm";
import { assignments } from "@/shared/db/schema";
import {
  claimExtraOffer,
  getExtraOfferById,
} from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import { logAudit } from "@/shared/infra/logger/audit";
import { findAssignmentByInternSlot } from "@/features/scheduling/infra/repositories/assignment-repository";

export async function executeClaimExtraOffer(params: {
  actor: { id: string; role: string; facultyId: string | null };
  offerId: string;
}) {
  const { actor, offerId } = params;

  if (!["INTERN", "LEADER"].includes(actor.role)) {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }

  const offer = await getExtraOfferById(offerId);
  if (!offer) {
    return { status: 404, body: { success: false, error: "Oferta não encontrada" } } as const;
  }
  if (offer.cancelledAt) {
    return { status: 409, body: { success: false, error: "Este plantão extra foi cancelado" } } as const;
  }
  if (offer.claimedBy) {
    return { status: 409, body: { success: false, error: "Este plantão extra já foi preenchido" } } as const;
  }

  // Check the claimer doesn't already have an assignment in this slot
  const existing = await findAssignmentByInternSlot({
    internId: actor.id,
    date: offer.date,
    period: offer.period,
    shift: (offer.shift as "MORNING" | "AFTERNOON" | null | undefined) ?? null,
  });
  if (existing && existing.status !== "CANCELLED") {
    return { status: 409, body: { success: false, error: "Você já tem um plantão neste dia e turno" } } as const;
  }

  // Always use the claiming intern's own faculty so the assignment appears in the
  // correct leader view and compliance report. offer.facultyId is only a display hint.
  const facultyId = actor.facultyId;
  if (!facultyId) {
    return { status: 422, body: { success: false, error: "Não foi possível determinar a faculdade. Tente novamente ou contate a coordenação." } } as const;
  }

  // Create the assignment inside a transaction
  let assignmentId: string;
  try {
    const [newAssignment] = await db
      .insert(assignments)
      .values({
        internId: actor.id,
        facultyId,
        baseId: offer.baseId,
        date: offer.date,
        period: offer.period,
        shift: (offer.shift as "MORNING" | "AFTERNOON") ?? undefined,
        status: "SCHEDULED",
        isExtraShift: true,
        extraShiftNotes: offer.notes ?? null,
        createdBy: actor.id,
        notes: `Plantão extra — oferta pública #${offerId.slice(0, 8)}`,
      })
      .returning({ id: assignments.id });
    assignmentId = newAssignment.id;
  } catch {
    return { status: 409, body: { success: false, error: "Conflito ao criar plantão. Tente novamente." } } as const;
  }

  // Atomic claim — if another request beat us, the update returns 0 rows
  const claimed = await claimExtraOffer(offerId, actor.id, assignmentId);
  if (!claimed) {
    // Rollback the assignment just created
    await db.delete(assignments).where(eq(assignments.id, assignmentId)).catch(() => {
      // best-effort cleanup
    });
    return { status: 409, body: { success: false, error: "Este plantão extra acabou de ser preenchido por outra pessoa" } } as const;
  }

  await logAudit({
    userId: actor.id,
    action: "extra_offer.claimed",
    entity: "extra_shift_offers",
    entityId: offerId,
    payload: { assignmentId, date: offer.date, baseId: offer.baseId },
  });

  return {
    status: 200,
    body: { success: true, data: { assignmentId, offerId } },
  } as const;
}
