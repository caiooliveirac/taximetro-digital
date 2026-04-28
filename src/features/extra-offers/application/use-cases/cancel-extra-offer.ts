import {
  cancelExtraOffer,
  getExtraOfferById,
} from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import { logAudit } from "@/shared/infra/logger/audit";

export async function executeCancelExtraOffer(params: {
  actor: { id: string; role: string };
  offerId: string;
}) {
  const { actor, offerId } = params;

  if (!["COORDINATOR", "LEADER"].includes(actor.role)) {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }

  const offer = await getExtraOfferById(offerId);
  if (!offer) {
    return { status: 404, body: { success: false, error: "Oferta não encontrada" } } as const;
  }
  if (offer.claimedBy) {
    return { status: 409, body: { success: false, error: "Oferta já foi reivindicada e não pode ser cancelada" } } as const;
  }
  if (offer.cancelledAt) {
    return { status: 409, body: { success: false, error: "Oferta já está cancelada" } } as const;
  }

  const cancelled = await cancelExtraOffer(offerId, actor.id);
  if (!cancelled) {
    return { status: 409, body: { success: false, error: "Não foi possível cancelar a oferta" } } as const;
  }

  await logAudit({
    userId: actor.id,
    action: "extra_offer.cancelled",
    entity: "extra_shift_offers",
    entityId: offerId,
  });

  return { status: 200, body: { success: true } } as const;
}
