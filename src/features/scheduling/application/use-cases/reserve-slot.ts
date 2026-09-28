/**
 * Vaga reservada pela coordenação.
 *
 * O coordenador segura UMA vaga aberta da grade de uma faculdade numa
 * data/turno. A vaga some da escala do líder (montar-escala), do sorteio e da
 * lista de vagas do interno, e não vai ao board de Extras — é a mesma oferta da
 * vaga liberada (release-slots.ts) com `reservedBy` preenchido. Cancelar a
 * reserva devolve a vaga para a faculdade.
 */

import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import { checkSlotAvailability } from "@/lib/slots";
import { localDateStr } from "@/lib/utils";
import {
  cancelReservation,
  insertExtraOffer,
  listReleasedOffers,
} from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import { getFacultyAbbreviation } from "@/features/scheduling/infra/repositories/lottery-repository";
import type { SchedulingActor } from "./cru-fixed-shared";

export const reserveSlotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.enum(["DAY", "NIGHT"]),
  baseId: z.string().uuid(),
  facultyId: z.string().uuid(),
  notes: z.string().trim().max(200).optional(),
});

export async function executeReserveSlot(params: {
  actor: SchedulingActor;
  input: z.infer<typeof reserveSlotSchema>;
}) {
  const { actor, input } = params;
  if (actor.role !== "COORDINATOR") return { status: 403, body: { success: false, error: "Sem permissão" } } as const;

  if (input.date < localDateStr()) {
    return { status: 400, body: { success: false, error: "Não dá para reservar vaga de data passada" } } as const;
  }

  // Já desconta as reservas vivas; as vagas cedidas às outras faculdades
  // também não estão livres para reservar.
  const slot = await checkSlotAvailability(input.baseId, input.date, input.period, input.facultyId);
  const cedidas = (await listReleasedOffers({ facultyId: input.facultyId, from: input.date, to: input.date }))
    .filter((r) => !r.reservedBy && r.baseId === input.baseId && r.period === input.period).length;
  if (slot.capacity - slot.assigned - cedidas <= 0) {
    return { status: 409, body: { success: false, error: "Não há vaga aberta desta faculdade neste turno" } } as const;
  }

  const reservedBy = actor.realUserId ?? actor.id;
  const abbr = await getFacultyAbbreviation(input.facultyId);
  const row = await insertExtraOffer({
    baseId: input.baseId,
    date: input.date,
    period: input.period,
    notes: input.notes || `Vaga da ${abbr ?? "faculdade"} reservada pela coordenação`,
    publishedBy: reservedBy,
    releasedFacultyId: input.facultyId,
    reservedBy,
  });

  await logAudit({
    userId: reservedBy,
    action: "SLOT_RESERVED",
    entity: "extra_shift_offers",
    entityId: row.id,
    payload: { facultyId: input.facultyId, facultyAbbr: abbr, baseId: input.baseId, date: input.date, period: input.period, notes: input.notes ?? null },
  });

  return { status: 200, body: { success: true, data: { id: row.id } } } as const;
}

export async function executeCancelReservation(params: { actor: SchedulingActor; id: string }) {
  const { actor, id } = params;
  if (actor.role !== "COORDINATOR") return { status: 403, body: { success: false, error: "Sem permissão" } } as const;

  const cancelledBy = actor.realUserId ?? actor.id;
  const row = await cancelReservation({ id, cancelledBy });
  if (!row) return { status: 404, body: { success: false, error: "Reserva não encontrada" } } as const;

  await logAudit({
    userId: cancelledBy,
    action: "SLOT_RESERVATION_CANCELLED",
    entity: "extra_shift_offers",
    entityId: row.id,
    payload: { facultyId: row.facultyId, baseId: row.baseId, date: row.date, period: row.period },
  });

  return { status: 200, body: { success: true } } as const;
}
