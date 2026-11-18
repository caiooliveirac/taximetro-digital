/**
 * O interno registra pela Dai que o preceptor saiu sem fazer o checkout dele
 * (regras em src/lib/sem-checkout.ts). Grava a justificativa padrão na falta
 * — ou no plantão ainda aberto, e o sweep a preserva ao virar falta. Não muda
 * status nem dá presença: abonar continua com a coordenação.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { assignments, bases, checkins } from "@/db/schema";
import { logAudit } from "@/shared/infra/logger/audit";
import { nomeDoPreceptor, PREFIXO_SEM_CHECKOUT, semCheckoutRegistravel, textoSemCheckout } from "@/lib/sem-checkout";

const erro = (status: number, error: string) => ({ status, body: { success: false, error } }) as const;

export async function executeRegistrarSemCheckout(p: { internId: string; assignmentId: string; preceptor: string; now?: Date }) {
  const now = p.now ?? new Date();
  const nome = nomeDoPreceptor(p.preceptor);
  if (!nome) return erro(400, "Diga o nome do médico (preceptor) que saiu sem fazer seu checkout.");

  const [a] = await db
    .select({
      id: assignments.id, internId: assignments.internId, status: assignments.status, isExtraShift: assignments.isExtraShift,
      date: assignments.date, period: assignments.period, shift: assignments.shift,
      justificativa: assignments.absenceJustification, baseCode: bases.code,
      checkinStatus: checkins.status, totpValidatedAt: checkins.totpValidatedAt, checkoutAt: checkins.checkoutAt, checkoutNotes: checkins.checkoutNotes,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .leftJoin(checkins, eq(checkins.assignmentId, assignments.id))
    .where(eq(assignments.id, p.assignmentId))
    .limit(1);
  if (!a || a.internId !== p.internId) return erro(404, "Plantão não encontrado.");
  if (!semCheckoutRegistravel({ ...a, date: String(a.date), checkinStatus: a.checkinStatus ?? null, totpValidatedAt: a.totpValidatedAt ?? null, checkoutAt: a.checkoutAt ?? null, checkoutNotes: a.checkoutNotes ?? null }, now)) {
    return erro(409, "Só dá para registrar em plantão com check-in validado e sem checkout.");
  }

  // Justificativa que o próprio interno escreveu antes fica, abaixo da nova.
  const anterior = a.justificativa?.trim();
  const texto = textoSemCheckout(nome, now);
  const justificativa = anterior && !anterior.startsWith(PREFIXO_SEM_CHECKOUT) ? `${texto}\n${anterior}` : texto;

  const [ok] = await db.update(assignments)
    .set({ absenceJustification: justificativa, absenceJustificationActor: "INTERN", absenceJustificationAt: now, updatedAt: now })
    .where(and(eq(assignments.id, a.id), eq(assignments.status, a.status)))
    .returning({ id: assignments.id });
  if (!ok) return erro(409, "O plantão mudou agora há pouco. Abra a Dai de novo e confira.");

  await logAudit({
    userId: p.internId,
    action: "INTERN_REPORTED_NO_CHECKOUT",
    entity: "assignment",
    entityId: a.id,
    payload: { preceptor: nome, baseCode: a.baseCode, date: String(a.date).slice(0, 10), period: a.period, status: a.status },
  });

  return {
    status: 200,
    body: { success: true, data: { texto: `Registrado: "${texto}" Fica como falta justificada, que a coordenação e o líder veem. Não vira presença.` } },
  } as const;
}
