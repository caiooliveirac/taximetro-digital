import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { assignments, bases, checkins, faculties, telegramBindings, userRoles, users } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { bot, TELEGRAM_BOT_TOKEN, TELEGRAM_GROUP_ID } from "@/lib/telegram";
import { getBrazilNowParts, localDateStr } from "@/lib/utils";

export type PendingCheckinRow = {
    internName: string;
    facultyAbbr: string | null;
    baseCode: string;
    baseName: string;
    baseType: "USA" | "CENTRAL" | "CRL";
    checkinStatus: string | null;
};

type SendReminderOptions = {
    dryRun?: boolean;
    notifyWhenEmpty?: boolean;
    targetChatId?: string;
    requestedByUserId?: string;
    requestedByTelegramId?: string;
    requestedByName?: string;
    source: "CRON" | "MANUAL_COMMAND";
    hourLabel?: string;
};

function compareRows(a: PendingCheckinRow, b: PendingCheckinRow) {
    const baseComparison = a.baseCode.localeCompare(b.baseCode, "pt-BR");
    if (baseComparison !== 0) return baseComparison;
    return a.internName.localeCompare(b.internName, "pt-BR");
}

export function formatHourLabel() {
    const hour = getBrazilNowParts().hour;
    return `${String(hour).padStart(2, "0")}h`;
}

function formatRow(row: PendingCheckinRow) {
    const faculty = row.facultyAbbr ? ` (${row.facultyAbbr})` : "";
    const pendingHint = row.checkinStatus === "PENDING" ? "\n⏳ Código gerado, mas ainda sem validação" : "";

    return [
        `• ${row.internName}${faculty}`,
        `📍 ${row.baseCode} — ${row.baseName}${pendingHint}`,
    ].join("\n");
}

function formatCopyableRow(row: PendingCheckinRow) {
    const faculty = row.facultyAbbr ? ` (${row.facultyAbbr})` : "";
    const pendingHint = row.checkinStatus === "PENDING" ? " | CODIGO GERADO SEM VALIDACAO" : "";

    return `${row.baseCode} | ${row.baseName} | ${row.internName}${faculty}${pendingHint}`;
}

function escapeHtml(value: string) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

export function buildPendingCheckinReminderCopyText(rows: PendingCheckinRow[]) {
    const regularRows = rows.filter((row) => row.baseCode !== "CRU").sort(compareRows);
    const cruRows = rows.filter((row) => row.baseCode === "CRU").sort(compareRows);
    const lines: string[] = [];

    if (regularRows.length > 0) {
        lines.push("PENDENCIAS");
        for (const row of regularRows) {
            lines.push(formatCopyableRow(row));
        }
    }

    if (cruRows.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push("CRU");
        for (const row of cruRows) {
            lines.push(formatCopyableRow(row));
        }
    }

    return lines.join("\n");
}

export function buildPendingCheckinReminderMessage(rows: PendingCheckinRow[], hourLabel = formatHourLabel()) {
    const regularRows = rows.filter((row) => row.baseCode !== "CRU").sort(compareRows);
    const cruRows = rows.filter((row) => row.baseCode === "CRU").sort(compareRows);
    const lines = [
        `🚨 Check-in pendente · ${hourLabel}`,
        "",
        `🟠 ${rows.length} interno(s) ainda sem check-in validado no plantão diurno.`,
    ];

    if (regularRows.length > 0) {
        lines.push("", "📋 Pendências");
        for (const row of regularRows) {
            lines.push(formatRow(row), "");
        }
        if (lines[lines.length - 1] === "") lines.pop();
    }

    if (cruRows.length > 0) {
        lines.push("", "🏥 CRU");
        for (const row of cruRows) {
            lines.push(formatRow(row), "");
        }
        if (lines[lines.length - 1] === "") lines.pop();
    }

    return lines.join("\n");
}

export function buildPendingCheckinReminderTelegramMessage(rows: PendingCheckinRow[], hourLabel = formatHourLabel()) {
    const copyText = buildPendingCheckinReminderCopyText(rows);

    return [
        `🚨 <b>Check-in pendente · ${escapeHtml(hourLabel)}</b>`,
        "",
        `🟠 ${rows.length} interno(s) ainda sem check-in validado no plantão diurno.`,
        "",
        "📋 <b>Copiar e colar</b>",
        `<pre>${escapeHtml(copyText)}</pre>`,
    ].join("\n");
}

export async function getPendingCheckinRows(date = localDateStr()) {
    return db
        .select({
            internName: users.name,
            facultyAbbr: faculties.abbreviation,
            baseCode: bases.code,
            baseName: bases.name,
            baseType: bases.type,
            checkinStatus: checkins.status,
        })
        .from(assignments)
        .innerJoin(users, eq(users.id, assignments.internId))
        .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
        .innerJoin(bases, eq(bases.id, assignments.baseId))
        .leftJoin(checkins, eq(checkins.assignmentId, assignments.id))
        .where(
            and(
                eq(assignments.date, date),
                eq(assignments.period, "DAY"),
                inArray(assignments.status, ["SCHEDULED", "CONFIRMED"]),
                ne(bases.type, "CRL"),
            ),
        )
        .orderBy(asc(bases.code), asc(users.name));
}

export async function canTriggerPendingReminderFromTelegram(telegramUserId: string) {
    const [binding] = await db
        .select({ userId: telegramBindings.userId })
        .from(telegramBindings)
        .where(eq(telegramBindings.telegramUserId, telegramUserId))
        .limit(1);

    if (!binding) {
        return { allowed: false as const, reason: "not-bound" as const };
    }

    const roles = await db
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(and(eq(userRoles.userId, binding.userId), eq(userRoles.isActive, true)));

    const allowedRoles = new Set(["COORDINATOR", "LEADER", "PRECEPTOR"]);
    const hasPermission = roles.some((entry) => allowedRoles.has(entry.role));

    if (!hasPermission) {
        return { allowed: false as const, reason: "insufficient-role" as const, userId: binding.userId };
    }

    return { allowed: true as const, userId: binding.userId };
}

export async function sendPendingCheckinReminder(options: SendReminderOptions) {
    const targetChatId = options.targetChatId?.trim() || TELEGRAM_GROUP_ID;

    if (!TELEGRAM_BOT_TOKEN || !targetChatId) {
        throw new Error("Telegram não configurado");
    }

    const date = localDateStr();
    const rows = await getPendingCheckinRows(date);
    const hourLabel = options.hourLabel ?? formatHourLabel();

    if (rows.length === 0) {
        const emptyMessage = `✅ Check-in em dia · ${hourLabel}\n\nNenhum interno está pendente no plantão diurno agora.`;

        if (!options.dryRun && options.notifyWhenEmpty) {
            await bot.api.sendMessage(targetChatId, emptyMessage);
        }

        await logAudit({
            userId: options.requestedByUserId,
            action: "TELEGRAM_CHECKIN_PENDING_REMINDER",
            entity: "assignment",
            payload: {
                date,
                hour: hourLabel,
                pendingCount: 0,
                dryRun: options.dryRun ?? false,
                notifyWhenEmpty: options.notifyWhenEmpty ?? false,
                targetChatId,
                source: options.source,
                requestedByTelegramId: options.requestedByTelegramId,
                requestedByName: options.requestedByName,
            },
        });

        return {
            sent: false,
            pendingCount: 0,
            preview: emptyMessage,
            reason: "Nenhum pendente",
        };
    }

    const preview = buildPendingCheckinReminderMessage(rows, hourLabel);
    const message = buildPendingCheckinReminderTelegramMessage(rows, hourLabel);

    if (!options.dryRun) {
        await bot.api.sendMessage(targetChatId, message, {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
        });
    }

    await logAudit({
        userId: options.requestedByUserId,
        action: "TELEGRAM_CHECKIN_PENDING_REMINDER",
        entity: "assignment",
        payload: {
            date,
            hour: hourLabel,
            pendingCount: rows.length,
            cruCount: rows.filter((row) => row.baseCode === "CRU").length,
            usaCount: rows.filter((row) => row.baseType === "USA").length,
            dryRun: options.dryRun ?? false,
            targetChatId,
            source: options.source,
            requestedByTelegramId: options.requestedByTelegramId,
            requestedByName: options.requestedByName,
        },
    });

    return {
        sent: !(options.dryRun ?? false),
        pendingCount: rows.length,
        preview,
    };
}