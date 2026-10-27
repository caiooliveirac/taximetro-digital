/**
 * Mensagem direta para a coordenação no Telegram: todo coordenador ativo que
 * vinculou a conta ao bot. Mesma regra de avisarInternoNoTelegram — é
 * cortesia, o banco é a verdade e a entrega NUNCA levanta.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramBindings, userRoles, users } from "@/db/schema";
import { bot, TELEGRAM_BOT_TOKEN } from "@/lib/telegram";

export async function avisarCoordenacaoNoTelegram(texto: string): Promise<number> {
  if (!TELEGRAM_BOT_TOKEN) return 0;
  try {
    const vinculos = await db
      .selectDistinct({ chatId: telegramBindings.telegramUserId })
      .from(telegramBindings)
      .innerJoin(users, eq(users.id, telegramBindings.userId))
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(and(eq(userRoles.role, "COORDINATOR"), eq(userRoles.isActive, true), eq(users.isActive, true)));
    const envios = await Promise.allSettled(vinculos.map((v) => bot.api.sendMessage(v.chatId, texto)));
    for (const e of envios) {
      if (e.status === "rejected") console.warn(`[telegram] aviso à coordenação falhou: ${e.reason instanceof Error ? e.reason.message : e.reason}`);
    }
    return envios.filter((e) => e.status === "fulfilled").length;
  } catch (erro) {
    console.warn(`[telegram] aviso à coordenação falhou: ${erro instanceof Error ? erro.message : erro}`);
    return 0;
  }
}
