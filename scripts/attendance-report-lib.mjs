// Biblioteca compartilhada de relatório de presenças + entrega via Telegram.
// Usada pelo backup diário (daily-db-backup.mjs) e pelo comando /relatorio do bot
// (telegram-send-attendance-report.mjs). Roda em node puro (sem bundler).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

// ─── Date helpers (America/Bahia) ──────────────────────────────────────────

export function getBahiaContext() {
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date());
    const hourNow = parseInt(
        new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Bahia",
            hour: "numeric",
            hour12: false,
        }).format(new Date()),
        10
    );
    return { todayStr, hourNow };
}

/**
 * Returns "done" | "scheduled" | "absent".
 * For NIGHT shifts: past only after 07:00 on D+1 in Bahia time.
 * For DAY shifts: past when date < today in Bahia.
 * date may be a Date object or "YYYY-MM-DD" string.
 */
export function classifyAssignment(assignment, todayStr, hourNow) {
    const { status, period } = assignment;
    const dateStr = assignment.date instanceof Date
        ? assignment.date.toISOString().split("T")[0]
        : String(assignment.date);

    if (status === "CHECKED_IN" || status === "CHECKED_OUT") return "done";
    if (status === "ABSENT") return "absent";

    if (status === "SCHEDULED" || status === "CONFIRMED") {
        let isPast;
        if (period === "NIGHT") {
            const nextDay = new Date(dateStr + "T12:00:00");
            nextDay.setDate(nextDay.getDate() + 1);
            const nextDayStr = nextDay.toISOString().split("T")[0];
            if (nextDayStr < todayStr) {
                isPast = true;
            } else if (nextDayStr === todayStr) {
                isPast = hourNow >= 7;
            } else {
                isPast = false;
            }
        } else {
            isPast = dateStr < todayStr;
        }
        return isPast ? "absent" : "scheduled";
    }
    return "scheduled";
}

export function sanitizeFilePart(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "relatorio";
}

// ─── HTML generation for attendance reports ────────────────────────────────

export function generateAttendanceReportHTML(faculty) {
    const FACULTY_COLORS = {
        EBMSP: { bg: "#d1fae5", text: "#065f46", emoji: "🟢" },
        UFBA: { bg: "#fed7aa", text: "#92400e", emoji: "🟠" },
        UNIFACS: { bg: "#fef3c7", text: "#92400e", emoji: "🟡" },
        ZARNS: { bg: "#bfdbfe", text: "#0c2d6b", emoji: "🔵" },
        AFYA: { bg: "#fbcfe8", text: "#831843", emoji: "🔴" },
    };

    function fmtDate(value) {
        const dateStr = value instanceof Date ? value.toISOString().split("T")[0] : String(value);
        const date = new Date(dateStr + "T12:00:00");
        return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).format(date);
    }

    function fmtTime(isoTime) {
        if (!isoTime) return "—";
        try { return new Date(isoTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
        catch { return "—"; }
    }

    function renderCard(a, group) {
        const periodIcon = a.period === "DAY" ? "☀️" : "🌙";
        const periodLabel = a.period === "DAY" ? "Dia" : "Noite";
        let statusEmoji, statusLabel, statusBg, statusColor, cardBg, cardBorder;
        if (group === "done") {
            statusEmoji = a.status === "CHECKED_IN" ? "🔵" : "✅";
            statusLabel = a.status === "CHECKED_IN" ? "Em andamento" : "Finalizado";
            statusBg = "#dcfce7"; statusColor = "#166534"; cardBg = "#f0fdf4"; cardBorder = "#10b981";
        } else if (group === "absent") {
            statusEmoji = "⚠️"; statusLabel = "Ausência";
            statusBg = "#fee2e2"; statusColor = "#991b1b"; cardBg = "#fff1f2"; cardBorder = "#f43f5e";
        } else {
            statusEmoji = a.status === "CONFIRMED" ? "✅" : "📅";
            statusLabel = a.status === "CONFIRMED" ? "Confirmado" : "Agendado";
            statusBg = "#f1f5f9"; statusColor = "#475569"; cardBg = "#f8fafc"; cardBorder = "#94a3b8";
        }
        const justNote = (group === "absent" && a.isJustified)
            ? `<div style="margin-top:6px;padding:5px 8px;background:#fffbeb;border-left:2px solid #f59e0b;border-radius:3px;font-size:12px;color:#92400e;">✓ Justificada${a.absenceJustification ? ` — "${a.absenceJustification}"` : ""}</div>`
            : (group === "absent" && !a.isJustified && a.status === "ABSENT")
                ? `<div style="margin-top:6px;padding:5px 8px;background:#fef2f2;border-left:2px solid #f43f5e;border-radius:3px;font-size:12px;color:#be123c;">⚠ Não justificada</div>`
                : (group === "absent")
                    ? `<div style="margin-top:6px;padding:5px 8px;background:#fef2f2;border-left:2px solid #f43f5e;border-radius:3px;font-size:12px;color:#be123c;">⚠ Não compareceu</div>`
                    : "";
        return `<div style="padding:10px 12px;margin-bottom:6px;border-radius:6px;background:${cardBg};border-left:3px solid ${cardBorder};font-size:13px;">
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
      <strong style="color:#0f172a;">${fmtDate(a.date)}</strong>
      <span style="background:#fffbeb;color:#92400e;padding:2px 7px;border-radius:3px;font-size:11px;font-weight:500;">${periodIcon} ${periodLabel}</span>
      <span style="background:#e2e8f0;color:#334155;padding:2px 7px;border-radius:3px;font-size:11px;font-weight:500;">${a.baseCode}</span>
      <span style="background:${statusBg};color:${statusColor};padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600;">${statusEmoji} ${statusLabel}</span>
    </div>
    <div style="margin-top:5px;font-size:12px;color:#64748b;display:flex;flex-wrap:wrap;gap:8px;">
      ${a.baseName ? `<span>${a.baseName}</span>` : ""}
      ${a.shift ? `<span style="background:#e8f4f8;padding:1px 6px;border-radius:3px;">${a.shift === "MORNING" ? "Manhã" : "Tarde"}</span>` : ""}
      ${a.checkinAt ? `<span>↳ Check-in: ${fmtTime(a.checkinAt)}</span>` : ""}
      ${a.checkoutAt ? `<span>↳ Check-out: ${fmtTime(a.checkoutAt)}</span>` : ""}
    </div>
    ${justNote}
  </div>`;
    }

    const { todayStr, hourNow } = getBahiaContext();
    const facultyColor = FACULTY_COLORS[faculty.facultyAbbr] || { bg: "#f3f4f6", text: "#374151", emoji: "⚪" };
    const generatedDate = new Date(faculty.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Bahia" });
    const activeInterns = faculty.interns.filter(i => !i.isArchived);
    const targetShifts = faculty.targetShifts ?? 0;
    const targetHours = faculty.targetHours ?? 0;
    const targetCRUsTotal = faculty.targetCRUsTotal ?? 0;

    // Faculty-level aggregates
    let facDone = 0, facScheduled = 0, facAbsent = 0, facCru = 0, facCrl = 0, facUsa = 0;
    for (const intern of activeInterns) {
        for (const a of intern.assignments) {
            const g = classifyAssignment(a, todayStr, hourNow);
            if (g === "done") {
                facDone++;
                if (a.baseType === "CENTRAL") facCru++;
                else if (a.baseType === "CRL") facCrl++;
                else if (a.baseType === "USA") facUsa++;
            } else if (g === "scheduled") {
                facScheduled++;
            } else {
                facAbsent++;
            }
        }
    }

    // Type group visual config
    const TYPE_GROUPS = [
        { key: "CENTRAL", label: "Regulação (CRU/CCO)", icon: "🏥", accentColor: "#1d4ed8", bgColor: "#eff6ff", chipBg: "#dbeafe", chipColor: "#1d4ed8" },
        { key: "CRL", label: "Intervenção / CRL", icon: "🏨", accentColor: "#7e22ce", bgColor: "#faf5ff", chipBg: "#f3e8ff", chipColor: "#7e22ce" },
        { key: "USA", label: "Viaturas", icon: "🚑", accentColor: "#b45309", bgColor: "#fffbeb", chipBg: "#fef3c7", chipColor: "#92400e" },
    ];

    function renderSubBlock(title, icon, count, headerBg, headerColor, cards) {
        return `<div class="block-section" style="margin-bottom:10px;">
    <div style="background:${headerBg};border-radius:5px 5px 0 0;padding:6px 10px;display:flex;align-items:center;gap:6px;border-bottom:1px solid #e2e8f0;">
      <span style="font-size:12px;">${icon}</span>
      <span style="font-weight:600;color:${headerColor};font-size:12px;">${title}</span>
      <span style="background:white;color:${headerColor};font-size:11px;font-weight:700;padding:0px 7px;border-radius:10px;margin-left:auto;">${count}</span>
    </div>
    <div style="background:white;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 5px 5px;padding:8px 10px;">
      ${cards}
    </div>
  </div>`;
    }

    function renderTypeGroup(cfg, doneItems, scheduledItems) {
        if (doneItems.length === 0 && scheduledItems.length === 0) return "";
        const doneChip = doneItems.length > 0
            ? `<span style="background:#dcfce7;color:#166534;padding:1px 8px;border-radius:4px;font-size:11px;font-weight:600;">✅ ${doneItems.length}</span>`
            : `<span style="background:#f1f5f9;color:#94a3b8;padding:1px 8px;border-radius:4px;font-size:11px;">✅ 0</span>`;
        const scheduledChip = scheduledItems.length > 0
            ? `<span style="background:#f1f5f9;color:#475569;padding:1px 8px;border-radius:4px;font-size:11px;font-weight:600;">📅 ${scheduledItems.length}</span>`
            : "";
        const doneBlock = doneItems.length > 0
            ? renderSubBlock("Cumpridos", "✅", doneItems.length, "#dcfce7", "#166534", doneItems.map(a => renderCard(a, "done")).join(""))
            : "";
        const scheduledBlock = scheduledItems.length > 0
            ? renderSubBlock("Agendados", "📅", scheduledItems.length, "#f1f5f9", "#475569", scheduledItems.map(a => renderCard(a, "scheduled")).join(""))
            : "";
        return `<div style="margin-bottom:18px;">
    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:${cfg.bgColor};border-radius:7px;margin-bottom:8px;border-left:4px solid ${cfg.accentColor};">
      <span style="font-size:17px;">${cfg.icon}</span>
      <span style="font-weight:700;color:${cfg.accentColor};font-size:13px;">${cfg.label}</span>
      <div style="margin-left:auto;display:flex;gap:4px;">${doneChip}${scheduledChip ? " " + scheduledChip : ""}</div>
    </div>
    <div style="padding-left:10px;">
      ${doneBlock}${scheduledBlock}
    </div>
  </div>`;
    }

    const internSections = activeInterns.map(intern => {
        const byType = {
            CENTRAL: { done: [], scheduled: [] },
            CRL: { done: [], scheduled: [] },
            USA: { done: [], scheduled: [] },
        };
        const absent = [];
        for (const a of intern.assignments) {
            const g = classifyAssignment(a, todayStr, hourNow);
            if (g === "absent") { absent.push(a); continue; }
            const typeKey = a.baseType === "CENTRAL" ? "CENTRAL" : a.baseType === "CRL" ? "CRL" : a.baseType === "USA" ? "USA" : "CENTRAL";
            byType[typeKey][g].push(a);
        }
        for (const t of ["CENTRAL", "CRL", "USA"]) {
            byType[t].done.sort((a, b) => String(b.date).localeCompare(String(a.date)));
            byType[t].scheduled.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        }
        absent.sort((a, b) => String(b.date).localeCompare(String(a.date)));

        const totalDone = byType.CENTRAL.done.length + byType.CRL.done.length + byType.USA.done.length;
        const totalScheduled = byType.CENTRAL.scheduled.length + byType.CRL.scheduled.length + byType.USA.scheduled.length;

        const typeChips = TYPE_GROUPS
            .filter(cfg => byType[cfg.key].done.length + byType[cfg.key].scheduled.length > 0)
            .map(cfg => {
                const t = byType[cfg.key];
                return `<span style="background:${cfg.chipBg};color:${cfg.chipColor};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${cfg.icon} ${cfg.label}: ✅${t.done.length}${t.scheduled.length > 0 ? ` 📅${t.scheduled.length}` : ""}</span>`;
            }).join(" ");

        const metaChips = [
            targetShifts > 0
                ? `<span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">🎯 Meta: ${totalDone}/${targetShifts} plantões</span>`
                : "",
            targetCRUsTotal > 0
                ? `<span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">🏥 Regulação: ${byType.CENTRAL.done.length}/${targetCRUsTotal}</span>`
                : "",
        ].filter(Boolean).join(" ");

        const statusChips = [
            totalDone > 0 ? `<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">✅ ${totalDone} cumprido${totalDone !== 1 ? "s" : ""}</span>` : "",
            totalScheduled > 0 ? `<span style="background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">📅 ${totalScheduled} agendado${totalScheduled !== 1 ? "s" : ""}</span>` : "",
            absent.length > 0 ? `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">⚠️ ${absent.length} ausência${absent.length !== 1 ? "s" : ""}</span>` : "",
        ].filter(Boolean).join(" ");

        const typeGroupBlocks = TYPE_GROUPS
            .map(cfg => renderTypeGroup(cfg, byType[cfg.key].done, byType[cfg.key].scheduled))
            .join("");

        const absentBlock = absent.length > 0
            ? `<div style="margin-bottom:18px;">
    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fff1f2;border-radius:7px;margin-bottom:8px;border-left:4px solid #f43f5e;">
      <span style="font-size:17px;">⚠️</span>
      <span style="font-weight:700;color:#be123c;font-size:13px;">Ausências</span>
      <span style="background:white;color:#be123c;font-size:11px;font-weight:700;padding:1px 8px;border-radius:10px;margin-left:auto;">${absent.length}</span>
    </div>
    <div style="padding-left:10px;">${absent.map(a => renderCard(a, "absent")).join("")}</div>
  </div>`
            : "";

        return `<div class="intern-section" style="background:white;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
    <div style="background:${facultyColor.bg};padding:12px 16px;border-bottom:1px solid #e2e8f0;">
      <div style="font-weight:700;color:${facultyColor.text};font-size:14px;margin-bottom:5px;">${intern.internName}</div>
      ${metaChips ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px;">${metaChips}</div>` : ""}
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px;">${typeChips || '<span style="font-size:11px;color:#94a3b8;">Nenhum plantão ainda</span>'}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">${statusChips || '<span style="font-size:11px;color:#94a3b8;">Sem plantões no período</span>'}</div>
    </div>
    <div style="padding:14px 16px;">
      ${intern.assignments.length === 0 ? '<div style="color:#94a3b8;font-size:12px;">Nenhum plantão registrado no período.</div>' : ""}
      ${typeGroupBlocks}${absentBlock}
    </div>
  </div>`;
    }).join("");

    const metaLine = targetShifts > 0
        ? `<div style="font-size:12px;color:${facultyColor.text}99;margin-top:2px;">Meta por interno: ${targetShifts} plantões${targetHours > 0 ? ` · ${targetHours}h` : ""}${targetCRUsTotal > 0 ? ` · ${targetCRUsTotal}x regulação` : ""}</div>`
        : "";

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatório de Presenças — ${faculty.facultyAbbr}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; line-height: 1.5; }
    .container { max-width: 940px; margin: 0 auto; padding: 24px 20px; }
    @media print {
      body { background: white; font-size: 11px; }
      .container { padding: 0; max-width: 100%; }
      .intern-section { page-break-inside: avoid; break-inside: avoid; }
      .block-section { break-inside: avoid; }
      .page-hint { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div style="background:linear-gradient(135deg,${facultyColor.bg},${facultyColor.text}18);border-left:5px solid ${facultyColor.text};padding:24px;margin-bottom:24px;border-radius:8px;">
      <div style="font-size:22px;font-weight:700;color:${facultyColor.text};margin-bottom:6px;">${facultyColor.emoji} ${faculty.facultyAbbr} — Relatório de Presenças</div>
      <div style="font-size:12px;color:${facultyColor.text}99;">Gerado em ${generatedDate} · Últimos 30 dias · ${activeInterns.length} interno(s)</div>
      ${metaLine}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:24px;">
      <div style="background:white;padding:12px;border-radius:6px;border-left:3px solid ${facultyColor.text};box-shadow:0 1px 3px rgba(0,0,0,0.07);"><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Internos</div><div style="font-size:22px;font-weight:700;color:${facultyColor.text};">${activeInterns.length}</div></div>
      <div style="background:white;padding:12px;border-radius:6px;border-left:3px solid #1d4ed8;box-shadow:0 1px 3px rgba(0,0,0,0.07);"><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Regulação cumpridos</div><div style="font-size:22px;font-weight:700;color:#1d4ed8;">${facCru}</div></div>
      <div style="background:white;padding:12px;border-radius:6px;border-left:3px solid #7e22ce;box-shadow:0 1px 3px rgba(0,0,0,0.07);"><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">CRL cumpridos</div><div style="font-size:22px;font-weight:700;color:#7e22ce;">${facCrl}</div></div>
      <div style="background:white;padding:12px;border-radius:6px;border-left:3px solid #92400e;box-shadow:0 1px 3px rgba(0,0,0,0.07);"><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Viaturas cumpridos</div><div style="font-size:22px;font-weight:700;color:#92400e;">${facUsa}</div></div>
      <div style="background:white;padding:12px;border-radius:6px;border-left:3px solid #10b981;box-shadow:0 1px 3px rgba(0,0,0,0.07);"><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Cumpridos</div><div style="font-size:22px;font-weight:700;color:#166534;">${facDone}</div></div>
      <div style="background:white;padding:12px;border-radius:6px;border-left:3px solid #94a3b8;box-shadow:0 1px 3px rgba(0,0,0,0.07);"><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Agendados</div><div style="font-size:22px;font-weight:700;color:#475569;">${facScheduled}</div></div>
      <div style="background:white;padding:12px;border-radius:6px;border-left:3px solid #f43f5e;box-shadow:0 1px 3px rgba(0,0,0,0.07);"><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Ausências</div><div style="font-size:22px;font-weight:700;color:#991b1b;">${facAbsent}</div></div>
    </div>
    ${internSections}
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">
      <p>Relatório automatizado — Taxímetro Digital</p>
      <p style="margin-top:2px;">Dashboard completo disponível em /taximetro/admin</p>
      <p class="page-hint" style="margin-top:6px;color:#cbd5e1;">Para salvar como PDF: Arquivo → Imprimir → Salvar como PDF</p>
    </div>
  </div>
</body>
</html>`;
}

export async function generateAttendanceReports(databaseUrl) {
    const sql = postgres(databaseUrl, {
        max: 1,
        prepare: false,
    });

    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

        const rows = await sql`
            SELECT
                f.id AS faculty_id,
                f.abbreviation AS faculty_abbr,
                f.name AS faculty_name,
                f.target_shifts AS target_shifts,
                f.target_hours AS target_hours,
                f.target_crus_total AS target_crus_total,
                u.id AS intern_id,
                u.name AS intern_name,
                ur.is_archived AS is_archived,
                a.id AS assignment_id,
                a.date AS assignment_date,
                a.period AS assignment_period,
                a.status AS assignment_status,
                a.shift AS assignment_shift,
                b.code AS base_code,
                b.name AS base_name,
                b.type AS base_type,
                c.checkin_at AS checkin_at,
                c.checkout_at AS checkout_at,
                a.absence_justification AS absence_justification,
                a.absence_justification_actor AS absence_justification_actor
            FROM user_roles ur
            INNER JOIN users u ON u.id = ur.user_id
            LEFT JOIN faculties f ON f.id = ur.faculty_id
            LEFT JOIN assignments a ON a.intern_id = u.id
                AND a.faculty_id = ur.faculty_id
                AND a.date >= ${thirtyDaysAgoStr}
                AND a.status != 'CANCELLED'
            LEFT JOIN bases b ON b.id = a.base_id
            LEFT JOIN checkins c ON c.assignment_id = a.id
            WHERE ur.role = 'INTERN'
                AND ur.is_active = true
                AND ur.is_archived = false
                AND u.is_active = true
            ORDER BY f.abbreviation ASC, u.name ASC, a.date DESC, a.period ASC
        `;

        // Process data
        const facultyMap = new Map();

        for (const row of rows) {
            const facultyKey = row.faculty_abbr ?? "SEM_FACULDADE";

            if (!facultyMap.has(facultyKey)) {
                facultyMap.set(facultyKey, {
                    facultyId: row.faculty_id,
                    facultyAbbr: row.faculty_abbr,
                    facultyName: row.faculty_name,
                    targetShifts: row.target_shifts ?? 0,
                    targetHours: row.target_hours ?? 0,
                    targetCRUsTotal: row.target_crus_total ?? 0,
                    generatedAt: new Date().toISOString(),
                    interns: new Map(),
                });
            }

            const faculty = facultyMap.get(facultyKey);
            const internKey = row.intern_id;

            if (!faculty.interns.has(internKey)) {
                faculty.interns.set(internKey, {
                    internId: row.intern_id,
                    internName: row.intern_name,
                    isArchived: row.is_archived,
                    assignments: [],
                    stats: {
                        totalUSAs: 0,
                        totalCheckedIn: 0,
                        totalCheckedOut: 0,
                        totalAbsent: 0,
                        totalAbsentJustified: 0,
                        totalAbsentNotJustified: 0,
                        totalScheduled: 0,
                    },
                });
            }

            const intern = faculty.interns.get(internKey);

            if (row.assignment_id) {
                const assignment = {
                    assignmentId: row.assignment_id,
                    date: row.assignment_date,
                    period: row.assignment_period,
                    baseCode: row.base_code,
                    baseName: row.base_name,
                    baseType: row.base_type,
                    status: row.assignment_status,
                    shift: row.assignment_shift,
                    checkinAt: row.checkin_at,
                    checkoutAt: row.checkout_at,
                    isJustified: Boolean(row.absence_justification),
                    absenceJustification: row.absence_justification,
                    absenceJustificationActor: row.absence_justification_actor,
                };

                // Deduplicate
                if (!intern.assignments.find(a => a.assignmentId === assignment.assignmentId)) {
                    intern.assignments.push(assignment);

                    // Update stats
                    if (assignment.baseType === "USA") intern.stats.totalUSAs++;
                    if (assignment.status === "CHECKED_IN") intern.stats.totalCheckedIn++;
                    if (assignment.status === "CHECKED_OUT") intern.stats.totalCheckedOut++;
                    if (assignment.status === "ABSENT") {
                        intern.stats.totalAbsent++;
                        if (assignment.absenceJustification) {
                            intern.stats.totalAbsentJustified++;
                        } else {
                            intern.stats.totalAbsentNotJustified++;
                        }
                    }
                    if (assignment.status === "SCHEDULED" || assignment.status === "CONFIRMED") {
                        intern.stats.totalScheduled++;
                    }
                }
            }
        }

        // Convert to array and generate HTML
        const faculties = Array.from(facultyMap.values()).map(faculty => ({
            ...faculty,
            interns: Array.from(faculty.interns.values())
                .filter(i => !i.isArchived)
                .sort((a, b) => a.internName.localeCompare(b.internName)),
        })).filter((faculty) => faculty.interns.length > 0);

        return faculties.map(faculty => ({
            facultyAbbr: faculty.facultyAbbr,
            html: generateAttendanceReportHTML(faculty),
        }));
    } catch (error) {
        console.warn(`[report] Warning: Could not generate attendance reports - ${error instanceof Error ? error.message : String(error)}`);
        return [];
    } finally {
        await sql.end({ timeout: 5 });
    }
}

// ─── HTML → PDF (chromium headless, opcional) ──────────────────────────────

const CHROMIUM_CANDIDATES = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export function findChromium() {
    return CHROMIUM_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

/** Converte HTML em PDF via chromium headless. Retorna Buffer, ou null se indisponível/falhar. */
export async function htmlToPdf(html) {
    const chromium = findChromium();
    if (!chromium) return null;

    const dir = await mkdtemp(path.join(tmpdir(), "report-pdf-"));
    const htmlPath = path.join(dir, "report.html");
    const pdfPath = path.join(dir, "report.pdf");

    try {
        await writeFile(htmlPath, html, "utf8");
        await new Promise((resolve, reject) => {
            const child = spawn(chromium, [
                "--headless",
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--no-pdf-header-footer",
                `--print-to-pdf=${pdfPath}`,
                `file://${htmlPath}`,
            ], { stdio: ["ignore", "ignore", "pipe"] });

            let stderr = "";
            child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
            child.on("error", reject);
            child.on("close", (code) => {
                if (code === 0) resolve();
                else reject(new Error(stderr.trim().split("\n").pop() || `chromium exit ${code}`));
            });
        });
        return await readFile(pdfPath);
    } catch (error) {
        console.warn(`[report] Conversão PDF falhou (${error instanceof Error ? error.message : String(error)}) — usando HTML.`);
        return null;
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

// ─── Telegram delivery ─────────────────────────────────────────────────────

export function resolveTelegramToken() {
    return process.env.TELEGRAM_BOT_TOKEN_NEXT?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
}

export async function sendTelegramText({ token, chatId, text }) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        throw new Error(`sendMessage falhou: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data.result;
}

export async function sendTelegramDocument({ token, chatId, filename, content, caption, contentType = "application/octet-stream" }) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (caption) form.append("caption", caption.slice(0, 1024));
    form.append("document", new Blob([content], { type: contentType }), filename);

    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: "POST",
        body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        throw new Error(`sendDocument falhou: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data.result;
}
