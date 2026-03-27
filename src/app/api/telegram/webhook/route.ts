import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { telegramBindings, users, qrSessions, checkins, assignments, bases, faculties } from "@/db/schema";
import { eq } from "drizzle-orm";
import { validateCode } from "@/lib/totp";
import { bot, TELEGRAM_GROUP_ID } from "@/lib/telegram";
import { logAudit } from "@/lib/audit";
import { formatBrazilTime } from "@/lib/utils";
import { z } from "zod/v4";

export async function POST(req: NextRequest) {
  const body = await req.json();

  try {
    const message = body.message;
    if (!message?.text || !message.from) return NextResponse.json({ ok: true });

    const text = message.text.trim();
    const telegramUserId = String(message.from.id);
    const chatId = String(message.chat.id);
    const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
    const telegramName = message.from.first_name + (message.from.last_name ? ` ${message.from.last_name}` : "");

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
          "• No grupo: envie somente o código de 6 dígitos do interno",
          { parse_mode: "Markdown" }
        );
        return NextResponse.json({ ok: true });
      }

      return NextResponse.json({ ok: true });
    }

    // Group messages — any 6-digit code validates (no binding required)
    if (/^\d{6}$/.test(text)) {
      return await handleGroupCodeValidation(text, telegramUserId, telegramName, chatId);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}

/** Resolve optional binding — returns userId if bound, null otherwise */
async function resolveBindingOptional(telegramUserId: string): Promise<string | null> {
  const [binding] = await db.select().from(telegramBindings)
    .where(eq(telegramBindings.telegramUserId, telegramUserId)).limit(1);
  return binding?.userId ?? null;
}

/** Group validation — any group member can validate by typing the 6-digit code */
async function handleGroupCodeValidation(code: string, telegramUserId: string, telegramName: string, chatId: string) {
  const session = await validateCode(code);
  if (!session) {
    await bot.api.sendMessage(chatId, "Código não encontrado ou expirado.");
    return NextResponse.json({ ok: true });
  }

  const [checkin] = await db.select().from(checkins).where(eq(checkins.id, session.checkinId)).limit(1);
  if (!checkin) return NextResponse.json({ ok: true });

  // If checkin is already VALIDATED, this is a CHECKOUT code
  if (checkin.status === "VALIDATED") {
    return await handleCheckoutViaCode(session, checkin, telegramUserId, telegramName, chatId, false);
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

  await bot.api.sendMessage(chatId,
    `✓ ${intern?.name} (${faculty?.abbreviation}) — ${base?.code} · ${period} · ${time} — ${telegramName}`
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
) {
  const validatorId = await resolveBindingOptional(telegramUserId);

  const [assignment] = await db.select().from(assignments).where(eq(assignments.id, checkin.assignmentId)).limit(1);
  if (!assignment) return NextResponse.json({ ok: true });

  // Transition: CHECKED_IN → CHECKED_OUT
  await db.update(assignments).set({ status: "CHECKED_OUT", updatedAt: new Date() }).where(eq(assignments.id, assignment.id));
  await db.update(checkins).set({ checkoutAt: new Date(), checkoutConfirmedBy: validatorId }).where(eq(checkins.id, checkin.id));
  await db.update(qrSessions).set({ consumedAt: new Date(), consumedBy: validatorId }).where(eq(qrSessions.id, session.id));

  const [intern] = await db.select().from(users).where(eq(users.id, assignment.internId)).limit(1);
  const [base] = await db.select().from(bases).where(eq(bases.id, assignment.baseId)).limit(1);
  const [faculty] = await db.select().from(faculties).where(eq(faculties.id, assignment.facultyId)).limit(1);

  const period = assignment.period === "DAY" ? "DIA" : "NOITE";
  const time = formatBrazilTime(new Date());

  if (isPrivate) {
    await bot.api.sendMessage(chatId,
      `⬜ *Checkout confirmado*\n\n*${intern?.name}*\n${faculty?.abbreviation}\nBase: ${base?.code} — ${base?.name} · ${period === "DIA" ? "Diurno" : "Noturno"}\n${time}`,
      { parse_mode: "Markdown" }
    );
    if (TELEGRAM_GROUP_ID) {
      try {
        await bot.api.sendMessage(TELEGRAM_GROUP_ID,
          `⬜ CHECKOUT ${intern?.name} (${faculty?.abbreviation}) — ${base?.code} · ${period} · ${time} — ${telegramName}`
        );
      } catch { /* group may not be configured */ }
    }
  } else {
    await bot.api.sendMessage(chatId,
      `⬜ CHECKOUT ${intern?.name} (${faculty?.abbreviation}) — ${base?.code} · ${period} · ${time} — ${telegramName}`
    );
  }

  await logAudit({
    userId: validatorId ?? undefined,
    action: isPrivate ? "CHECKOUT_VALIDATED_TELEGRAM_QR" : "CHECKOUT_VALIDATED_TELEGRAM_GROUP",
    entity: "assignment",
    entityId: assignment.id,
    payload: { telegramUserId, telegramName, bound: !!validatorId },
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

  // Detailed response in private chat
  await bot.api.sendMessage(chatId,
    `✓ *Presença validada*\n\n` +
    `*${intern?.name}*\n` +
    `${faculty?.abbreviation} · Interno(a)\n` +
    `Base: ${base?.code} — ${base?.name} · ${period}\n` +
    `${assignment.date}`,
    { parse_mode: "Markdown" }
  );

  // Also post confirmation in group
  if (TELEGRAM_GROUP_ID) {
    const time = formatBrazilTime(new Date());
    try {
      await bot.api.sendMessage(TELEGRAM_GROUP_ID,
        `✓ ${intern?.name} (${faculty?.abbreviation}) — ${base?.code} · ${period === "Diurno" ? "DIA" : "NOITE"} · ${time} — ${telegramName}`
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
