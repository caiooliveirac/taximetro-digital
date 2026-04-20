import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { telegramBindings, users, qrSessions, checkins, assignments, bases, faculties } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { validateCode } from "@/lib/totp";
import { bot, TELEGRAM_GROUP_ID } from "@/lib/telegram";
import { logAudit } from "@/lib/audit";
import { formatBrazilTime } from "@/lib/utils";
import { canTriggerPendingReminderFromTelegram, sendPendingCheckinReminder } from "@/lib/telegram-checkin-pending-reminder";
import { z } from "zod/v4";

const PRECEPTOR_REGISTRATION_URL = "https://mnrs.com.br/taximetro/registro/9NPQUwOwats7IZDuLbpuUw";

function formatValidationNudge() {
  return [
    "💡 Dica para preceptor:",
    "Só digitar o código no grupo funciona, mas no site é mais fácil e permite avaliar o interno (NPS), não só registrar presença.",
    `Cadastro: ${PRECEPTOR_REGISTRATION_URL}`,
  ].join("\n");
}

async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: {
    messageThreadId?: number;
    parseMode?: "Markdown";
  },
) {
  const payload: Record<string, unknown> = {};
  if (options?.parseMode) payload.parse_mode = options.parseMode;
  if (typeof options?.messageThreadId === "number") payload.message_thread_id = options.messageThreadId;

  try {
    await bot.api.sendMessage(chatId, text, payload);
    return;
  } catch (err) {
    // Some supergroups/topics may reject thread delivery after topic changes.
    // Retry without thread targeting to avoid losing the confirmation message.
    if (typeof options?.messageThreadId === "number") {
      const fallbackPayload: Record<string, unknown> = {};
      if (options?.parseMode) fallbackPayload.parse_mode = options.parseMode;
      await bot.api.sendMessage(chatId, text, fallbackPayload);
      return;
    }
    throw err;
  }
}

function extractCommand(text: string) {
  const match = text.match(/^\/([a-zA-Z_]+)(?:@[^\s]+)?(?:\s+.*)?$/);
  return match?.[1]?.toLowerCase() ?? null;
}

function shouldUseUnifiedShiftCheckout(assignment: { period: string; shift: string | null }) {
  return assignment.period === "DAY" && (assignment.shift === "MORNING" || assignment.shift === "AFTERNOON");
}

async function resolveUnifiedCheckoutAssignmentIds(assignment: {
  id: string;
  internId: string;
  date: string;
  period: string;
  shift: string | null;
}) {
  if (!shouldUseUnifiedShiftCheckout(assignment)) return [assignment.id];

  const related = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.internId, assignment.internId),
        eq(assignments.date, assignment.date),
        eq(assignments.period, "DAY"),
        inArray(assignments.shift, ["MORNING", "AFTERNOON"]),
        eq(assignments.status, "CHECKED_IN"),
      ),
    );

  const ids = related.map((row) => row.id);
  if (!ids.includes(assignment.id)) ids.push(assignment.id);
  return ids;
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  try {
    const message = body.message;
    if (!message?.text || !message.from) return NextResponse.json({ ok: true });

    const text = message.text.trim();
    const telegramUserId = String(message.from.id);
    const chatId = String(message.chat.id);
    const messageThreadId = typeof message.message_thread_id === "number"
      ? message.message_thread_id
      : undefined;
    const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
    const telegramName = message.from.first_name + (message.from.last_name ? ` ${message.from.last_name}` : "");
    const command = extractCommand(text);

    // Private commands
    if (!isGroup) {
      // /start CODE — QR deep link flow (preceptor scans intern QR)
      if (text.startsWith("/start ")) {
        const code = text.slice(7).trim();
        if (/^\d{6}$/.test(code)) {
          return await handlePrivateCodeValidation(code, telegramUserId, telegramName, chatId);
        }
        await bot.api.sendMessage(chatId, "Código inválido. Use um código de 6 dígitos.");
        return NextResponse.json({ ok: true });
      }

      // /vincular CPF
      if (text.startsWith("/vincular ")) {
        const cpf = text.slice(10).trim();
        return await handleBinding(cpf, telegramUserId, message.from.first_name, chatId);
      }

      // /ajuda
      if (text === "/ajuda" || text === "/help") {
        await bot.api.sendMessage(chatId,
          "🩺 *Taxímetro Bot*\n\n" +
          "Comandos:\n" +
          "• `/vincular 000.000.000-00` — vincular seu Telegram ao cadastro\n" +
          "• Escaneie o QR Code do interno para abrir o grupo\n" +
          "• No grupo: envie somente o código de 6 dígitos do interno\n" +
          "• No grupo: `/pendencias` — avisar faltas de check-in do plantão diurno",
          { parse_mode: "Markdown" }
        );
        return NextResponse.json({ ok: true });
      }

      return NextResponse.json({ ok: true });
    }

    if (command === "pendencias" || command === "checkinspendentes") {
      return await handleManualPendingReminderCommand(telegramUserId, telegramName, chatId, isGroup, messageThreadId);
    }

    // Group messages — any 6-digit code validates (no binding required)
    if (/^\d{6}$/.test(text)) {
      return await handleGroupCodeValidation(text, telegramUserId, telegramName, chatId, messageThreadId);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}

async function handleManualPendingReminderCommand(
  telegramUserId: string,
  telegramName: string,
  chatId: string,
  isGroup: boolean,
  messageThreadId?: number,
) {
  if (!isGroup) {
    await sendTelegramMessage(chatId, "Use este comando no grupo de validação.", { messageThreadId });
    return NextResponse.json({ ok: true });
  }

  if (TELEGRAM_GROUP_ID && chatId !== TELEGRAM_GROUP_ID) {
    await sendTelegramMessage(chatId, "Este comando só está habilitado no grupo oficial de validação.", { messageThreadId });
    return NextResponse.json({ ok: true });
  }

  const permission = await canTriggerPendingReminderFromTelegram(telegramUserId);

  if (!permission.allowed) {
    const message = permission.reason === "not-bound"
      ? "Comando indisponível para este Telegram. Faça primeiro /vincular 000.000.000-00 no privado do bot."
      : "Comando disponível apenas para coordenação, liderança ou preceptoria vinculadas.";
    await sendTelegramMessage(chatId, message, { messageThreadId });
    return NextResponse.json({ ok: true });
  }

  const result = await sendPendingCheckinReminder({
    notifyWhenEmpty: true,
    requestedByUserId: permission.userId,
    requestedByTelegramId: telegramUserId,
    requestedByName: telegramName,
    source: "MANUAL_COMMAND",
  });

  if (result.pendingCount > 0) {
    await sendTelegramMessage(chatId, `📣 Alerta manual disparado por ${telegramName}.`, { messageThreadId });
  }

  return NextResponse.json({ ok: true });
}

/** Resolve optional binding — returns userId if bound, null otherwise */
async function resolveBindingOptional(telegramUserId: string): Promise<string | null> {
  const [binding] = await db.select().from(telegramBindings)
    .where(eq(telegramBindings.telegramUserId, telegramUserId)).limit(1);
  return binding?.userId ?? null;
}

/** Group validation — any group member can validate by typing the 6-digit code */
async function handleGroupCodeValidation(
  code: string,
  telegramUserId: string,
  telegramName: string,
  chatId: string,
  messageThreadId?: number,
) {
  const session = await validateCode(code);
  if (!session) {
    await sendTelegramMessage(chatId, "Código não encontrado ou expirado.", { messageThreadId });
    return NextResponse.json({ ok: true });
  }

  const [checkin] = await db.select().from(checkins).where(eq(checkins.id, session.checkinId)).limit(1);
  if (!checkin) return NextResponse.json({ ok: true });

  // If checkin is already VALIDATED, this is a CHECKOUT code
  if (checkin.status === "VALIDATED") {
    return await handleCheckoutViaCode(session, checkin, telegramUserId, telegramName, chatId, false, messageThreadId);
  }

  const [assignment] = await db.select().from(assignments).where(eq(assignments.id, checkin.assignmentId)).limit(1);
  if (!assignment) return NextResponse.json({ ok: true });

  // Try to resolve binding for audit — nullable
  const validatorId = await resolveBindingOptional(telegramUserId);

  // Update checkin
  await db.update(checkins).set({
    status: "VALIDATED",
    validatedBy: validatorId,
    totpValidatedAt: new Date(),
    method: "TELEGRAM_CODE",
  }).where(eq(checkins.id, session.checkinId));

  await db.update(qrSessions).set({ consumedAt: new Date(), consumedBy: validatorId }).where(eq(qrSessions.id, session.id));
  await db.update(assignments).set({ status: "CHECKED_IN", updatedAt: new Date() }).where(eq(assignments.id, checkin.assignmentId));

  const [intern] = await db.select().from(users).where(eq(users.id, assignment.internId)).limit(1);
  const [base] = await db.select().from(bases).where(eq(bases.id, assignment.baseId)).limit(1);
  const [faculty] = await db.select().from(faculties).where(eq(faculties.id, assignment.facultyId)).limit(1);

  const period = assignment.period === "DAY" ? "DIA" : "NOITE";
  const time = formatBrazilTime(new Date());
  const facultyLabel = faculty?.abbreviation ?? "Sem faculdade";
  const baseLabel = `${base?.code ?? "--"} — ${base?.name ?? "Base não identificada"}`;

  await sendTelegramMessage(chatId,
    [
      "✅ Check-in validado",
      `Interno: ${intern?.name ?? "Não identificado"}`,
      `Faculdade: ${facultyLabel}`,
      `Base: ${baseLabel}`,
      `Turno: ${period}`,
      `Hora: ${time}`,
      `Validação por: ${telegramName}`,
      "",
      formatValidationNudge(),
    ].join("\n"),
    { messageThreadId },
  );

  await logAudit({
    userId: validatorId ?? undefined,
    action: "CHECKIN_VALIDATED_TELEGRAM_GROUP",
    entity: "checkin",
    entityId: session.checkinId,
    payload: { telegramUserId, telegramName, bound: !!validatorId },
  });

  return NextResponse.json({ ok: true });
}

/** Shared checkout handler — validates checkout via Telegram code (group or private) */
async function handleCheckoutViaCode(
  session: { id: string; checkinId: string },
  checkin: { id: string; assignmentId: string },
  telegramUserId: string, telegramName: string, chatId: string,
  isPrivate: boolean,
  messageThreadId?: number,
) {
  const validatorId = await resolveBindingOptional(telegramUserId);

  const [assignment] = await db.select().from(assignments).where(eq(assignments.id, checkin.assignmentId)).limit(1);
  if (!assignment) return NextResponse.json({ ok: true });

  const assignmentIdsToCheckout = await resolveUnifiedCheckoutAssignmentIds(assignment);
  const now = new Date();

  // Transition: CHECKED_IN → CHECKED_OUT
  await db.update(assignments).set({ status: "CHECKED_OUT", updatedAt: now }).where(inArray(assignments.id, assignmentIdsToCheckout));
  await db.update(checkins).set({ checkoutAt: now, checkoutConfirmedBy: validatorId }).where(inArray(checkins.assignmentId, assignmentIdsToCheckout));
  await db.update(qrSessions).set({ consumedAt: now, consumedBy: validatorId }).where(eq(qrSessions.id, session.id));

  const [intern] = await db.select().from(users).where(eq(users.id, assignment.internId)).limit(1);
  const [base] = await db.select().from(bases).where(eq(bases.id, assignment.baseId)).limit(1);
  const [faculty] = await db.select().from(faculties).where(eq(faculties.id, assignment.facultyId)).limit(1);

  const period = assignment.period === "DAY" ? "DIA" : "NOITE";
  const time = formatBrazilTime(new Date());
  const facultyLabel = faculty?.abbreviation ?? "Sem faculdade";
  const baseLabel = `${base?.code ?? "--"} — ${base?.name ?? "Base não identificada"}`;

  if (isPrivate) {
    await sendTelegramMessage(chatId,
      [
        "⬜ Checkout confirmado",
        `Interno: ${intern?.name ?? "Não identificado"}`,
        `Faculdade: ${facultyLabel}`,
        `Base: ${baseLabel}`,
        `Turno: ${period === "DIA" ? "Diurno" : "Noturno"}`,
        `Hora: ${time}`,
        "",
        formatValidationNudge(),
      ].join("\n"),
    );
    if (TELEGRAM_GROUP_ID) {
      try {
        await sendTelegramMessage(TELEGRAM_GROUP_ID,
          [
            "⬜ Checkout validado no privado",
            `Interno: ${intern?.name ?? "Não identificado"}`,
            `Faculdade: ${facultyLabel}`,
            `Base: ${baseLabel}`,
            `Turno: ${period}`,
            `Hora: ${time}`,
            `Validação por: ${telegramName}`,
            "",
            formatValidationNudge(),
          ].join("\n"),
        );
      } catch { /* group may not be configured */ }
    }
  } else {
    await sendTelegramMessage(chatId,
      [
        "⬜ Checkout validado",
        `Interno: ${intern?.name ?? "Não identificado"}`,
        `Faculdade: ${facultyLabel}`,
        `Base: ${baseLabel}`,
        `Turno: ${period}`,
        `Hora: ${time}`,
        `Validação por: ${telegramName}`,
        "",
        formatValidationNudge(),
      ].join("\n"),
      { messageThreadId },
    );
  }

  await logAudit({
    userId: validatorId ?? undefined,
    action: isPrivate ? "CHECKOUT_VALIDATED_TELEGRAM_QR" : "CHECKOUT_VALIDATED_TELEGRAM_GROUP",
    entity: "assignment",
    entityId: assignment.id,
    payload: {
      telegramUserId,
      telegramName,
      bound: !!validatorId,
      ...(assignmentIdsToCheckout.length > 1 ? { unified: true, assignmentIds: assignmentIdsToCheckout } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

/** Private chat validation via /start CODE — no role check, security via group */
async function handlePrivateCodeValidation(code: string, telegramUserId: string, telegramName: string, chatId: string) {
  const validatorId = await resolveBindingOptional(telegramUserId);

  const session = await validateCode(code);
  if (!session) {
    await bot.api.sendMessage(chatId, "Código não encontrado ou expirado. Peça ao interno para gerar novo.");
    return NextResponse.json({ ok: true });
  }

  const [checkin] = await db.select().from(checkins).where(eq(checkins.id, session.checkinId)).limit(1);
  if (!checkin) return NextResponse.json({ ok: true });

  // If checkin is already VALIDATED, this is a CHECKOUT code
  if (checkin.status === "VALIDATED") {
    return await handleCheckoutViaCode(session, checkin, telegramUserId, telegramName, chatId, true);
  }

  const [assignment] = await db.select().from(assignments).where(eq(assignments.id, checkin.assignmentId)).limit(1);
  if (!assignment) return NextResponse.json({ ok: true });

  // Update checkin
  await db.update(checkins).set({
    status: "VALIDATED",
    validatedBy: validatorId,
    totpValidatedAt: new Date(),
    method: "TELEGRAM_QR",
  }).where(eq(checkins.id, session.checkinId));

  await db.update(qrSessions).set({ consumedAt: new Date(), consumedBy: validatorId }).where(eq(qrSessions.id, session.id));
  await db.update(assignments).set({ status: "CHECKED_IN", updatedAt: new Date() }).where(eq(assignments.id, checkin.assignmentId));

  const [intern] = await db.select().from(users).where(eq(users.id, assignment.internId)).limit(1);
  const [base] = await db.select().from(bases).where(eq(bases.id, assignment.baseId)).limit(1);
  const [faculty] = await db.select().from(faculties).where(eq(faculties.id, assignment.facultyId)).limit(1);

  const period = assignment.period === "DAY" ? "Diurno" : "Noturno";
  const periodShort = assignment.period === "DAY" ? "DIA" : "NOITE";
  const time = formatBrazilTime(new Date());
  const facultyLabel = faculty?.abbreviation ?? "Sem faculdade";
  const baseLabel = `${base?.code ?? "--"} — ${base?.name ?? "Base não identificada"}`;

  // Detailed response in private chat
  await bot.api.sendMessage(chatId,
    [
      "✅ Presença validada",
      `Interno: ${intern?.name ?? "Não identificado"}`,
      `Faculdade: ${facultyLabel}`,
      `Base: ${baseLabel}`,
      `Turno: ${period}`,
      `Data: ${assignment.date}`,
      `Hora: ${time}`,
      "",
      formatValidationNudge(),
    ].join("\n")
  );

  // Also post confirmation in group
  if (TELEGRAM_GROUP_ID) {
    try {
      await bot.api.sendMessage(TELEGRAM_GROUP_ID,
        [
          "✅ Check-in validado no privado",
          `Interno: ${intern?.name ?? "Não identificado"}`,
          `Faculdade: ${facultyLabel}`,
          `Base: ${baseLabel}`,
          `Turno: ${periodShort}`,
          `Hora: ${time}`,
          `Validação por: ${telegramName}`,
          "",
          formatValidationNudge(),
        ].join("\n")
      );
    } catch { /* group may not be configured yet */ }
  }

  await logAudit({
    userId: validatorId ?? undefined,
    action: "CHECKIN_VALIDATED_TELEGRAM_QR",
    entity: "checkin",
    entityId: session.checkinId,
    payload: { telegramUserId, telegramName, bound: !!validatorId },
  });

  return NextResponse.json({ ok: true });
}

async function handleBinding(cpf: string, telegramUserId: string, telegramName: string, chatId: string) {
  const cpfParsed = z.string().regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/).safeParse(cpf);
  if (!cpfParsed.success) {
    await bot.api.sendMessage(chatId, "CPF inválido. Use o formato 000.000.000-00");
    return NextResponse.json({ ok: true });
  }

  const [user] = await db.select().from(users).where(eq(users.cpf, cpf)).limit(1);
  if (!user) {
    await bot.api.sendMessage(chatId, "CPF não encontrado no sistema.");
    return NextResponse.json({ ok: true });
  }

  const [existing] = await db.select().from(telegramBindings)
    .where(eq(telegramBindings.userId, user.id)).limit(1);
  if (existing) {
    await bot.api.sendMessage(chatId, "Este CPF já está vinculado a um Telegram.");
    return NextResponse.json({ ok: true });
  }

  await db.insert(telegramBindings).values({ telegramUserId, userId: user.id, telegramName });
  await bot.api.sendMessage(chatId, `✓ Telegram vinculado a ${user.name}`);
  await logAudit({ userId: user.id, action: "TELEGRAM_BINDING", entity: "telegram_binding" });
  return NextResponse.json({ ok: true });
}
