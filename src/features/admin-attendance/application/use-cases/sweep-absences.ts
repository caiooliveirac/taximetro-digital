import { and, eq, gte, inArray, lt, not } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { assignments, checkins } from "@/shared/db/schema";
import { logAudit } from "@/shared/infra/logger/audit";
import { getBrazilNowParts, localDateStr } from "@/lib/utils";

// Falta automática: checkout é a medida de presença. Plantão de dias anteriores
// sem checkout vira ABSENT. Janela limitada para não reprocessar histórico
// antigo na primeira execução (mesmo horizonte das telas de faltas).
export const ABSENCE_SWEEP_WINDOW_DAYS = 60;

export async function executeAbsenceSweep() {
  const today = localDateStr();
  const yesterday = localDateStr(new Date(Date.now() - 86400000));
  const windowStart = localDateStr(new Date(Date.now() - ABSENCE_SWEEP_WINDOW_DAYS * 86400000));
  const now = new Date();

  const conditions = [
    inArray(assignments.status, ["SCHEDULED", "CONFIRMED", "CHECKED_IN"] as const),
    lt(assignments.date, today),
    gte(assignments.date, windowStart),
    eq(assignments.isExtraShift, false),
  ];

  // Plantão noturno de ontem pode fazer checkout até 12:00 de hoje —
  // antes disso ele ainda não é falta.
  if (getBrazilNowParts().hour < 12) {
    conditions.push(not(and(eq(assignments.date, yesterday), eq(assignments.period, "NIGHT"))!));
  }

  const overdue = await db
    .select({
      id: assignments.id,
      internId: assignments.internId,
      facultyId: assignments.facultyId,
      date: assignments.date,
      period: assignments.period,
      status: assignments.status,
    })
    .from(assignments)
    .where(and(...conditions));

  if (overdue.length === 0) return { swept: 0 };

  const ids = overdue.map((a) => a.id);

  await db.transaction(async (tx) => {
    await tx.update(checkins).set({
      status: "REJECTED",
      checkoutNotes: "Falta automática: plantão encerrado sem checkout",
    }).where(inArray(checkins.assignmentId, ids));

    await tx.update(assignments).set({ status: "ABSENT", updatedAt: now })
      .where(inArray(assignments.id, ids));
  });

  for (const a of overdue) {
    await logAudit({
      userId: a.internId,
      action: "AUTO_ABSENCE_RECORDED",
      entity: "assignment",
      entityId: a.id,
      payload: { previousStatus: a.status, date: a.date, period: a.period, facultyId: a.facultyId },
    });
  }

  return { swept: overdue.length };
}
