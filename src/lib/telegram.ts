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
