import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/shared/db/client";
import { assignments, bases, checkins, faculties, qrSessions, telegramBindings, userRoles, users } from "@/shared/db/schema";
import { logAudit } from "@/shared/infra/logger/audit";
import { bot, TELEGRAM_BOT_TOKEN } from "@/lib/telegram";
import { localDateStr } from "@/lib/utils";
import { pickPlausibleShiftTimes } from "@/features/admin-attendance/application/plausible-shift-times";

export const manualAttendanceSchema = z.object({
  assignmentId: z.string().uuid(),
  action: z.enum(["CONFIRM_PRESENT", "CONFIRM_CHECKOUT", "MARK_ABSENT"]),
});

function formatShiftPeriod(period: string) {
  return period === "DAY" ? "Diurno" : "Noturno";
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

async function notifyFacultyLeadersAbsence(params: {
  facultyId: string;
  internName: string;
  facultyAbbr: string;
  baseCode: string;
  date: string;
  period: string;
  recordedBy: string;
}) {
  if (!TELEGRAM_BOT_TOKEN) return 0;

  const leaders = await db
    .select({ chatId: telegramBindings.telegramUserId })
    .from(userRoles)
    .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.isActive, true)))
    .innerJoin(telegramBindings, eq(telegramBindings.userId, userRoles.userId))
    .where(and(
      eq(userRoles.role, "LEADER"),
      eq(userRoles.facultyId, params.facultyId),
      eq(userRoles.isActive, true),
    ));

  if (leaders.length === 0) return 0;

  const message = [
    "Falta registrada manualmente no Taximetro Digital.",
    `Interno: ${params.internName}`,
    `Faculdade: ${params.facultyAbbr}`,
    `Base: ${params.baseCode}`,
    `Turno: ${formatShiftPeriod(params.period)}`,
    `Data: ${formatDate(params.date)}`,
    `Registrado por: ${params.recordedBy}`,
  ].join("\n");

  const results = await Promise.allSettled(leaders.map((leader) => bot.api.sendMessage(leader.chatId, message)));
  return results.filter((result) => result.status === "fulfilled").length;
}

export async function executeManualAttendance(params: {
  actor: { id: string; name?: string | null };
  input: z.infer<typeof manualAttendanceSchema>;
}) {
  const { assignmentId, action } = params.input;

  const [assignment] = await db
    .select({
      id: assignments.id,
      internId: assignments.internId,
      facultyId: assignments.facultyId,
      date: assignments.date,
      period: assignments.period,
      status: assignments.status,
      internName: users.name,
      baseCode: bases.code,
      facultyAbbr: faculties.abbreviation,
    })
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.internId))
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  if (!assignment) return { status: 404, body: { success: false, error: "Plantão não encontrado" } } as const;
  if (assignment.status === "CANCELLED") return { status: 409, body: { success: false, error: "Plantão cancelado" } } as const;

  const now = new Date();
  const isRetroactive = assignment.date < localDateStr();
  const recordedBy = String(params.actor.name ?? "Admin");

  const [existingCheckin] = await db
    .select({ id: checkins.id, status: checkins.status, checkinAt: checkins.checkinAt })
    .from(checkins)
    .where(eq(checkins.assignmentId, assignmentId))
    .limit(1);

  if (action === "CONFIRM_PRESENT") {
    if (!["SCHEDULED", "CONFIRMED", "ABSENT"].includes(assignment.status)) {
      return { status: 409, body: { success: false, error: "Este plantão não pode mais ser confirmado manualmente" } } as const;
    }

    // Horário sintético plausível para que o relatório do diretor não exponha
    // o instante (potencialmente dias depois) em que o coordenador clicou.
    const plausible = pickPlausibleShiftTimes({ date: assignment.date, period: assignment.period });
    const syntheticCheckinAt = plausible.checkinAt;

    await db.transaction(async (tx) => {
      if (existingCheckin) {
        await tx.update(checkins).set({
          checkinAt: syntheticCheckinAt,
          geoValid: true,
          status: "VALIDATED",
          validatedBy: params.actor.id,
          totpValidatedAt: syntheticCheckinAt,
          method: "APP_DIRECT",
        }).where(eq(checkins.id, existingCheckin.id));

        await tx.update(qrSessions).set({ consumedAt: now, consumedBy: params.actor.id })
          .where(and(eq(qrSessions.checkinId, existingCheckin.id), isNull(qrSessions.consumedAt)));
      } else {
        await tx.insert(checkins).values({
          assignmentId,
          internId: assignment.internId,
          checkinAt: syntheticCheckinAt,
          geoValid: true,
          status: "VALIDATED",
          validatedBy: params.actor.id,
          totpValidatedAt: syntheticCheckinAt,
          method: "APP_DIRECT",
        });
      }

      await tx.update(assignments).set({
        status: "CHECKED_IN",
        absenceJustification: null,
        absenceJustificationActor: null,
        absenceJustificationAt: null,
        updatedAt: now,
      }).where(eq(assignments.id, assignmentId));
    });

    await logAudit({
      userId: params.actor.id,
      action: "MANUAL_ATTENDANCE_CONFIRMED",
      entity: "assignment",
      entityId: assignmentId,
      payload: {
        previousStatus: assignment.status,
        previousCheckinStatus: existingCheckin?.status ?? null,
        internId: assignment.internId,
        facultyId: assignment.facultyId,
        retroactive: isRetroactive,
        syntheticCheckinAt: syntheticCheckinAt.toISOString(),
        previousCheckinAt: existingCheckin?.checkinAt ? existingCheckin.checkinAt.toISOString() : null,
      },
    });

    return { status: 200, body: { success: true, data: { status: "CHECKED_IN", leaderNotificationsSent: 0 } } } as const;
  }

  if (action === "CONFIRM_CHECKOUT") {
    if (assignment.status !== "CHECKED_IN") {
      return { status: 409, body: { success: false, error: "Só é possível confirmar checkout de um plantão em CHECKED_IN" } } as const;
    }

    if (!existingCheckin || existingCheckin.status !== "VALIDATED") {
      return { status: 409, body: { success: false, error: "Checkout manual exige um check-in validado" } } as const;
    }

    // Horário sintético plausível de fim de turno. Se o checkinAt existente já é
    // posterior (caso degenerado), garante que checkoutAt > checkinAt + 11h.
    const plausible = pickPlausibleShiftTimes({ date: assignment.date, period: assignment.period });
    let syntheticCheckoutAt = plausible.checkoutAt;
    if (existingCheckin.checkinAt) {
      const minCheckout = new Date(existingCheckin.checkinAt.getTime() + 11 * 60 * 60 * 1000);
      if (syntheticCheckoutAt < minCheckout) syntheticCheckoutAt = minCheckout;
    }

    await db.transaction(async (tx) => {
      await tx.update(assignments).set({
        status: "CHECKED_OUT",
        absenceJustification: null,
        absenceJustificationActor: null,
        absenceJustificationAt: null,
        updatedAt: now,
      }).where(eq(assignments.id, assignmentId));

      await tx.update(checkins).set({
        checkoutAt: syntheticCheckoutAt,
        checkoutConfirmedBy: params.actor.id,
        checkoutNotes: "Checkout confirmado manualmente pelo admin",
      }).where(eq(checkins.id, existingCheckin.id));

      await tx.update(qrSessions).set({ consumedAt: now, consumedBy: params.actor.id })
        .where(and(eq(qrSessions.checkinId, existingCheckin.id), isNull(qrSessions.consumedAt)));
    });

    await logAudit({
      userId: params.actor.id,
      action: "MANUAL_CHECKOUT_CONFIRMED",
      entity: "assignment",
      entityId: assignmentId,
      payload: {
        previousStatus: assignment.status,
        previousCheckinStatus: existingCheckin.status,
        internId: assignment.internId,
        facultyId: assignment.facultyId,
        retroactive: isRetroactive,
        syntheticCheckoutAt: syntheticCheckoutAt.toISOString(),
      },
    });

    return { status: 200, body: { success: true, data: { status: "CHECKED_OUT", leaderNotificationsSent: 0 } } } as const;
  }

  if (!["SCHEDULED", "CONFIRMED", "ABSENT", "CHECKED_IN"].includes(assignment.status)) {
    return { status: 409, body: { success: false, error: "Este plantão não pode mais ser lançado como falta" } } as const;
  }

  await db.transaction(async (tx) => {
    if (existingCheckin) {
      await tx.update(checkins).set({
        status: "REJECTED",
        validatedBy: null,
        totpValidatedAt: null,
        checkoutAt: null,
        checkoutConfirmedBy: null,
        checkoutNotes: "Falta registrada manualmente pelo admin",
      }).where(eq(checkins.id, existingCheckin.id));

      await tx.update(qrSessions).set({ consumedAt: now, consumedBy: params.actor.id })
        .where(and(eq(qrSessions.checkinId, existingCheckin.id), isNull(qrSessions.consumedAt)));
    }

    await tx.update(assignments).set({ status: "ABSENT", updatedAt: now }).where(eq(assignments.id, assignmentId));
  });

  const leaderNotificationsSent = await notifyFacultyLeadersAbsence({
    facultyId: assignment.facultyId,
    internName: assignment.internName,
    facultyAbbr: assignment.facultyAbbr,
    baseCode: assignment.baseCode,
    date: assignment.date,
    period: assignment.period,
    recordedBy,
  }).catch(() => 0);

  await logAudit({
    userId: params.actor.id,
    action: "MANUAL_ABSENCE_RECORDED",
    entity: "assignment",
    entityId: assignmentId,
    payload: {
      previousStatus: assignment.status,
      previousCheckinStatus: existingCheckin?.status ?? null,
      internId: assignment.internId,
      facultyId: assignment.facultyId,
      leaderNotificationsSent,
      retroactive: isRetroactive,
    },
  });

  return { status: 200, body: { success: true, data: { status: "ABSENT", leaderNotificationsSent } } } as const;
}
