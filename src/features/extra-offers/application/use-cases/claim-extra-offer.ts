import { db } from "@/shared/db/client";
import { eq } from "drizzle-orm";
import { assignments, bases, faculties, users } from "@/shared/db/schema";
import {
  claimExtraOffer,
  getExtraOfferById,
} from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import { logAudit } from "@/shared/infra/logger/audit";
import { findAssignmentByInternSlot } from "@/features/scheduling/infra/repositories/assignment-repository";
import { getValidInternIdsForFaculty } from "@/features/scheduling/infra/repositories/lottery-repository";

/**
 * Duas situações passam por aqui:
 * - Extra comum: o interno (ou o líder, por si) pega a oferta do board.
 * - Vaga livre (oferta com `releasedFacultyId`): o líder ou o coordenador
 *   aloca um interno da faculdade dele na vaga que outra faculdade liberou.
 *   Vira plantão normal, não extra — é o plantão do interno, só que numa vaga
 *   emprestada. Ver release-slots.ts.
 */
export async function executeClaimExtraOffer(params: {
  actor: { id: string; role: string; facultyId: string | null };
  offerId: string;
  /** Líder/coordenador alocando outro interno. Sem isso, o ator pega para si. */
  internId?: string;
  /** Coordenador precisa dizer a faculdade do interno; o líder usa a dele. */
  facultyId?: string;
}) {
  const { actor, offerId } = params;

  const alocandoOutro = Boolean(params.internId && params.internId !== actor.id);
  const permitido = alocandoOutro
    ? ["LEADER", "COORDINATOR"].includes(actor.role)
    : ["INTERN", "LEADER"].includes(actor.role);
  if (!permitido) {
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
    return { status: 409, body: { success: false, error: "Esta vaga já foi preenchida" } } as const;
  }

  // Always use the intern's own faculty so the assignment appears in the
  // correct leader view and compliance report. offer.facultyId is only a display hint.
  const facultyId = actor.role === "COORDINATOR" ? params.facultyId ?? null : actor.facultyId;
  if (!facultyId) {
    return { status: 422, body: { success: false, error: "Não foi possível determinar a faculdade. Tente novamente ou contate a coordenação." } } as const;
  }

  // Vaga que a própria faculdade liberou é para as outras — se ela usasse,
  // estaria ocupando a vaga que disse que não ia usar.
  if (offer.releasedFacultyId && offer.releasedFacultyId === facultyId) {
    return { status: 409, body: { success: false, error: "Sua faculdade liberou esta vaga para as outras" } } as const;
  }

  const internId = params.internId ?? actor.id;
  if (alocandoOutro) {
    const validos = await getValidInternIdsForFaculty({ facultyId, internIds: [internId] });
    if (!validos.has(internId)) {
      return { status: 400, body: { success: false, error: "Interno não pertence a esta faculdade" } } as const;
    }
  }

  // Check the intern doesn't already have an assignment in this slot
  const existing = await findAssignmentByInternSlot({
    internId,
    date: offer.date,
    period: offer.period,
    shift: (offer.shift as "MORNING" | "AFTERNOON" | null | undefined) ?? null,
  });
  if (existing && existing.status !== "CANCELLED") {
    return { status: 409, body: { success: false, error: alocandoOutro ? "Este interno já tem um plantão neste dia e turno" : "Você já tem um plantão neste dia e turno" } } as const;
  }

  const vagaLivre = Boolean(offer.releasedFacultyId);
  const [quemLiberou] = vagaLivre
    ? await db.select({ abbr: faculties.abbreviation }).from(faculties).where(eq(faculties.id, offer.releasedFacultyId!)).limit(1)
    : [null];

  // Create the assignment inside a transaction
  let assignmentId: string;
  try {
    const [newAssignment] = await db
      .insert(assignments)
      .values({
        internId,
        facultyId,
        baseId: offer.baseId,
        date: offer.date,
        period: offer.period,
        shift: (offer.shift as "MORNING" | "AFTERNOON") ?? undefined,
        status: "SCHEDULED",
        isExtraShift: !vagaLivre,
        extraShiftNotes: vagaLivre ? null : offer.notes ?? null,
        createdBy: actor.id,
        notes: vagaLivre
          ? `Vaga livre liberada pela ${quemLiberou?.abbr ?? "outra faculdade"}`
          : `Plantão extra — oferta pública #${offerId.slice(0, 8)}`,
      })
      .returning({ id: assignments.id });
    assignmentId = newAssignment.id;
  } catch {
    return { status: 409, body: { success: false, error: "Conflito ao criar plantão. Tente novamente." } } as const;
  }

  // Atomic claim — if another request beat us, the update returns 0 rows
  const claimed = await claimExtraOffer(offerId, internId, assignmentId);
  if (!claimed) {
    // Rollback the assignment just created
    await db.delete(assignments).where(eq(assignments.id, assignmentId)).catch(() => {
      // best-effort cleanup
    });
    return { status: 409, body: { success: false, error: "Esta vaga acabou de ser preenchida por outra pessoa" } } as const;
  }

  if (vagaLivre) {
    // Nomes no payload de propósito: a auditoria mostra isto em português.
    const [[interno], [bs], [fac]] = await Promise.all([
      db.select({ name: users.name }).from(users).where(eq(users.id, internId)).limit(1),
      db.select({ code: bases.code }).from(bases).where(eq(bases.id, offer.baseId)).limit(1),
      db.select({ abbr: faculties.abbreviation }).from(faculties).where(eq(faculties.id, facultyId)).limit(1),
    ]);
    await logAudit({
      userId: actor.id,
      action: "FREE_SLOT_USED",
      entity: "extra_shift_offers",
      entityId: offerId,
      payload: {
        assignmentId,
        internName: interno?.name ?? null,
        facultyAbbr: fac?.abbr ?? null,
        releasedByAbbr: quemLiberou?.abbr ?? null,
        baseCode: bs?.code ?? null,
        date: offer.date,
        period: offer.period,
      },
    });
  } else {
    await logAudit({
      userId: actor.id,
      action: "extra_offer.claimed",
      entity: "extra_shift_offers",
      entityId: offerId,
      payload: { assignmentId, date: offer.date, baseId: offer.baseId },
    });
  }

  return {
    status: 200,
    body: { success: true, data: { assignmentId, offerId } },
  } as const;
}
