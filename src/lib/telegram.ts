import { Bot } from "grammy";

export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN_NEXT?.trim() ||
  process.env.TELEGRAM_BOT_TOKEN?.trim() ||
  "";

if (!TELEGRAM_BOT_TOKEN) {
  console.warn("TELEGRAM_BOT_TOKEN not set (TELEGRAM_BOT_TOKEN_NEXT/TELEGRAM_BOT_TOKEN) — bot disabled");
}

export const bot = new Bot(TELEGRAM_BOT_TOKEN || "dummy");
export const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID || "";

function normalizeChatId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  // Telegram migracao group -> supergroup costuma introduzir prefixo -100.
  // Aceitamos comparacao legacy-safe para evitar falso negativo em comando.
  return trimmed.replace(/^-?100/, "").replace(/^-/, "");
}

function parseAllowedGroupIds(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isTelegramValidationGroup(chatId: string): boolean {
  const allowed = parseAllowedGroupIds(TELEGRAM_GROUP_ID);
  if (allowed.length === 0) return true;

  const incoming = chatId.trim();
  if (!incoming) return false;

  if (allowed.includes(incoming)) return true;

  const normalizedIncoming = normalizeChatId(incoming);
  return allowed.some((candidate) => normalizeChatId(candidate) === normalizedIncoming);
}
