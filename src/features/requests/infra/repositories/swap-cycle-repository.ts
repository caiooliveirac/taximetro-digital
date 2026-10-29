/**
 * Persistência da troca a três (roda). A regra vive em
 * src/shared/domain/policies/swap-cycle-policy.ts — aqui só entra banco.
 */

import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { assignments, extraShiftOffers, requests, swapCycleLegs, swapCycles } from "@/shared/db/schema";

export type RodaGravada = {
  id: string;
  status: string;
  proposedBy: string;
  createdAt: Date;
  pernas: { internId: string; givesAssignmentId: string; receivesAssignmentId: string; position: number; confirmedAt: Date | null }[];
};

async function comPernas(rodas: (typeof swapCycles.$inferSelect)[]): Promise<RodaGravada[]> {
  if (rodas.length === 0) return [];
  const pernas = await db.select().from(swapCycleLegs).where(inArray(swapCycleLegs.cycleId, rodas.map((r) => r.id)));
  return rodas.map((r) => ({
    id: r.id,
    status: r.status,
    proposedBy: r.proposedBy,
    createdAt: r.createdAt,
    pernas: pernas
      .filter((p) => p.cycleId === r.id)
      .sort((a, b) => a.position - b.position)
      .map((p) => ({ internId: p.internId, givesAssignmentId: p.givesAssignmentId, receivesAssignmentId: p.receivesAssignmentId, position: p.position, confirmedAt: p.confirmedAt })),
  }));
}

export async function rodaPorId(id: string): Promise<RodaGravada | null> {
  const [r] = await db.select().from(swapCycles).where(eq(swapCycles.id, id)).limit(1);
  return r ? (await comPernas([r]))[0] : null;
}

/** Rodas ainda em aberto de que o interno participa. */
export async function rodasAbertasDe(internId: string): Promise<RodaGravada[]> {
  const ids = await db.select({ id: swapCycleLegs.cycleId }).from(swapCycleLegs).where(eq(swapCycleLegs.internId, internId));
  if (ids.length === 0) return [];
  const rodas = await db.select().from(swapCycles)
    .where(and(inArray(swapCycles.id, ids.map((i) => i.id)), eq(swapCycles.status, "PROPOSTA")));
  return comPernas(rodas);
}

/** Plantões presos em alguma roda aberta: não entram em outra troca. */
export async function plantoesEmRodaAberta(): Promise<Set<string>> {
  const linhas = await db
    .select({ id: swapCycleLegs.givesAssignmentId })
    .from(swapCycleLegs)
    .innerJoin(swapCycles, eq(swapCycles.id, swapCycleLegs.cycleId))
    .where(eq(swapCycles.status, "PROPOSTA"));
  return new Set(linhas.map((l) => l.id));
}

export async function criarRoda(params: {
  proposedBy: string;
  pernas: { internId: string; givesAssignmentId: string; receivesAssignmentId: string }[];
}): Promise<string> {
  return db.transaction(async (tx) => {
    const [roda] = await tx.insert(swapCycles).values({ proposedBy: params.proposedBy }).returning({ id: swapCycles.id });
    await tx.insert(swapCycleLegs).values(params.pernas.map((p, position) => ({
      cycleId: roda.id,
      ...p,
      position,
      // Quem propõe já está dizendo sim.
      confirmedAt: p.internId === params.proposedBy ? new Date() : null,
    })));
    return roda.id;
  });
}

export async function confirmarPerna(cycleId: string, internId: string) {
  await db.update(swapCycleLegs).set({ confirmedAt: new Date() })
    .where(and(eq(swapCycleLegs.cycleId, cycleId), eq(swapCycleLegs.internId, internId)));
}

export async function fecharRoda(cycleId: string, status: "RECUSADA" | "CANCELADA" | "EXPIRADA", motivo: string) {
  await db.update(swapCycles).set({ status, closedAt: new Date(), closedReason: motivo })
    .where(and(eq(swapCycles.id, cycleId), eq(swapCycles.status, "PROPOSTA")));
}

/**
 * Aplica a roda de uma vez: cancela os três plantões, cria os três novos (cada
 * um com a faculdade de quem recebe), registra as cessões entre faculdades e
 * fecha as ofertas abertas desses plantões. Tudo ou nada.
 * Devolve false se a roda já não estava aberta (outra confirmação chegou antes).
 */
export async function aplicarRoda(params: { cycleId: string; aplicadoPor: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Trava a roda: duas confirmações simultâneas não aplicam duas vezes.
    const [roda] = await tx.select().from(swapCycles).where(eq(swapCycles.id, params.cycleId)).for("update");
    if (!roda || roda.status !== "PROPOSTA") return false;

    const pernas = await tx.select().from(swapCycleLegs).where(eq(swapCycleLegs.cycleId, params.cycleId));
    const ids = pernas.map((p) => p.givesAssignmentId);
    const plantoes = await tx.select().from(assignments).where(inArray(assignments.id, ids));
    const porId = new Map(plantoes.map((p) => [p.id, p]));
    if (plantoes.length !== 3 || plantoes.some((p) => !["SCHEDULED", "CONFIRMED"].includes(p.status))) {
      throw new Error("Um dos plantões da roda mudou antes de aplicar.");
    }

    await tx.update(assignments)
      .set({ status: "CANCELLED", updatedAt: new Date(), notes: "Trocado numa troca a três" })
      .where(inArray(assignments.id, ids));

    const agora = new Date();
    for (const p of pernas) {
      const entrega = porId.get(p.givesAssignmentId)!;
      const recebe = porId.get(p.receivesAssignmentId)!;
      const [novo] = await tx.insert(assignments).values({
        internId: p.internId,
        facultyId: entrega.facultyId,
        baseId: recebe.baseId,
        date: recebe.date,
        period: recebe.period,
        shift: recebe.shift,
        createdBy: params.aplicadoPor,
        notes: "Troca a três entre internos",
      }).returning({ id: assignments.id });

      // Mesma regra da troca em dupla (cross-faculty-swap-policy.ts): a vaga
      // cedida fica registrada como liberada já ocupada por quem recebeu.
      if (recebe.facultyId !== entrega.facultyId) {
        await tx.insert(extraShiftOffers).values({
          baseId: recebe.baseId,
          date: recebe.date,
          period: recebe.period,
          shift: recebe.shift,
          releasedFacultyId: recebe.facultyId,
          claimedBy: p.internId,
          claimedAt: agora,
          assignmentId: novo.id,
          publishedBy: params.aplicadoPor,
          autoRelease: "TROCA",
          notes: "Cedida numa troca a três entre internos de faculdades diferentes",
        });
      }
    }

    // As ofertas desses plantões saem do mercado: o plantão já foi trocado.
    await tx.update(requests)
      .set({ status: "CANCELLED", reviewNotes: "Fechada numa troca a três" })
      .where(and(
        inArray(requests.status, ["OPEN", "PENDING"]),
        or(inArray(requests.assignmentId, ids), inArray(requests.targetAssignmentId, ids)),
      ));

    await tx.update(swapCycles).set({ status: "CONCLUIDA", closedAt: agora }).where(eq(swapCycles.id, params.cycleId));
    return true;
  });
}
