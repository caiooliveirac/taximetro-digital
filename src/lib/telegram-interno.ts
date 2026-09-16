/**
 * Mensagem direta para um interno no Telegram, se ele vinculou a conta.
 *
 * É cortesia, como o aviso ao secretário: o registro no banco é a verdade, e
 * a entrega NUNCA levanta. Sem token, sem vínculo ou com o Telegram fora,
 * devolve false e quem chamou decide o que dizer na tela.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramBindings } from "@/db/schema";
import { bot, TELEGRAM_BOT_TOKEN } from "@/lib/telegram";

export async function avisarInternoNoTelegram(userId: string, texto: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) return false;
  try {
    const [vinculo] = await db
      .select({ chatId: telegramBindings.telegramUserId })
      .from(telegramBindings)
      .where(eq(telegramBindings.userId, userId))
      .limit(1);
    if (!vinculo) return false;
    await bot.api.sendMessage(vinculo.chatId, texto);
    return true;
  } catch (erro) {
    console.warn(`[telegram] aviso ao interno ${userId} falhou: ${erro instanceof Error ? erro.message : erro}`);
    return false;
  }
}
