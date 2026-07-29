// Gera o relatório de presenças (um por faculdade) e envia como PDF ao chat
// Telegram informado. Disparado pelo comando /relatorio do bot (webhook) e
// utilizável manualmente: node scripts/telegram-send-attendance-report.mjs <chat_id>
//
// Env: DATABASE_URL (obrigatório), TELEGRAM_BOT_TOKEN_NEXT ou TELEGRAM_BOT_TOKEN.

import process from "node:process";
import {
    generateAttendanceReports,
    htmlToPdf,
    resolveTelegramToken,
    sanitizeFilePart,
    sendTelegramDocument,
    sendTelegramText,
} from "./attendance-report-lib.mjs";

const chatId = process.argv[2]?.trim() || process.env.TARGET_CHAT_ID?.trim();
const databaseUrl = process.env.DATABASE_URL;
const token = resolveTelegramToken();

if (!chatId || !databaseUrl || !token) {
    console.error("[relatorio] chat_id, DATABASE_URL e token Telegram são obrigatórios.");
    process.exit(1);
}

const dateStamp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date());

try {
    const reports = await generateAttendanceReports(databaseUrl);

    if (reports.length === 0) {
        await sendTelegramText({
            token,
            chatId,
            text: "📊 Ainda não há internos ativos com plantões para gerar o relatório.",
        });
        process.exit(0);
    }

    for (const report of reports) {
        const baseName = `relatorio-${sanitizeFilePart(report.facultyAbbr)}-${dateStamp}`;
        const pdf = await htmlToPdf(report.html);

        if (pdf) {
            await sendTelegramDocument({
                token,
                chatId,
                filename: `${baseName}.pdf`,
                content: pdf,
                contentType: "application/pdf",
                caption: `📊 Relatório de presenças — ${report.facultyAbbr} (últimos 30 dias)`,
            });
        } else {
            await sendTelegramDocument({
                token,
                chatId,
                filename: `${baseName}.html`,
                content: Buffer.from(report.html, "utf8"),
                contentType: "text/html",
                caption: `📊 Relatório de presenças — ${report.facultyAbbr} (HTML — abra no navegador)`,
            });
        }
    }

    console.log(`[relatorio] ${reports.length} relatório(s) enviado(s) para ${chatId}.`);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[relatorio] Falha: ${message}`);
    try {
        await sendTelegramText({ token, chatId, text: `⚠️ Não consegui gerar o relatório: ${message}` });
    } catch {
        // sem fallback adicional
    }
    process.exit(1);
}
