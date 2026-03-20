import { Bot } from "grammy";

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.warn("TELEGRAM_BOT_TOKEN not set — bot disabled");
}

export const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || "dummy");
export const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID || "";
