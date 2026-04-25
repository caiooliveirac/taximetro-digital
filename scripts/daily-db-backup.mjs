import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import nodemailer from "nodemailer";
import postgres from "postgres";

// ─── Date helpers (America/Bahia) ──────────────────────────────────────────

function getBahiaContext() {
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
function classifyAssignment(assignment, todayStr, hourNow) {
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

function sanitizeFilePart(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "relatorio";
}


// HTML generation for attendance reports
function generateAttendanceReportHTML(faculty) {
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

    function renderBlock(title, icon, count, headerBg, headerColor, cards) {
        return `<div class="block-section" style="margin-bottom:14px;">
    <div style="background:${headerBg};border-radius:6px 6px 0 0;padding:7px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #e2e8f0;">
      <span>${icon}</span>
      <span style="font-weight:600;color:${headerColor};font-size:13px;">${title}</span>
      <span style="background:white;color:${headerColor};font-size:11px;font-weight:700;padding:1px 8px;border-radius:12px;margin-left:auto;">${count}</span>
    </div>
    <div style="background:white;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 6px 6px;padding:10px 12px;">
      ${cards}
    </div>
  </div>`;
    }

    const { todayStr, hourNow } = getBahiaContext();
    const facultyColor = FACULTY_COLORS[faculty.facultyAbbr] || { bg: "#f3f4f6", text: "#374151", emoji: "⚪" };
    const generatedDate = new Date(faculty.generatedAt).toLocaleString("pt-BR");
    const activeInterns = faculty.interns.filter(i => !i.isArchived);

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
        { key: "CENTRAL", label: "CRU", icon: "🏥", accentColor: "#1d4ed8", bgColor: "#eff6ff", chipBg: "#dbeafe", chipColor: "#1d4ed8" },
        { key: "CRL", label: "Intervenção / CRL", icon: "🏨", accentColor: "#7e22ce", bgColor: "#faf5ff", chipBg: "#f3e8ff", chipColor: "#7e22ce" },
        { key: "USA", label: "USA", icon: "🚑", accentColor: "#b45309", bgColor: "#fffbeb", chipBg: "#fef3c7", chipColor: "#92400e" },
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
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px;">${typeChips || '<span style="font-size:11px;color:#94a3b8;">Nenhum plantão ainda</span>'}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">${statusChips || '<span style="font-size:11px;color:#94a3b8;">Sem plantões no período</span>'}</div>
    </div>
    <div style="padding:14px 16px;">
      ${intern.assignments.length === 0 ? '<div style="color:#94a3b8;font-size:12px;">Nenhum plantão registrado no período.</div>' : ""}
      ${typeGroupBlocks}${absentBlock}
    </div>
  </div>`;
    }).join("");

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
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:24px;">
      <div style="background:white;padding:12px;border-radius:6px;border-left:3px solid ${facultyColor.text};box-shadow:0 1px 3px rgba(0,0,0,0.07);"><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Internos</div><div style="font-size:22px;font-weight:700;color:${facultyColor.text};">${activeInterns.length}</div></div>
      <div style="background:white;padding:12px;border-radius:6px;border-left:3px solid #1d4ed8;box-shadow:0 1px 3px rgba(0,0,0,0.07);"><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">CRU cumpridos</div><div style="font-size:22px;font-weight:700;color:#1d4ed8;">${facCru}</div></div>
      <div style="background:white;padding:12px;border-radius:6px;border-left:3px solid #7e22ce;box-shadow:0 1px 3px rgba(0,0,0,0.07);"><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">CRL cumpridos</div><div style="font-size:22px;font-weight:700;color:#7e22ce;">${facCrl}</div></div>
      <div style="background:white;padding:12px;border-radius:6px;border-left:3px solid #92400e;box-shadow:0 1px 3px rgba(0,0,0,0.07);"><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">USA cumpridos</div><div style="font-size:22px;font-weight:700;color:#92400e;">${facUsa}</div></div>
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


async function generateAttendanceReports(databaseUrl) {
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
        console.warn(`[db-backup] Warning: Could not generate attendance reports - ${error instanceof Error ? error.message : String(error)}`);
        return [];
    } finally {
        await sql.end({ timeout: 5 });
    }
}

const DEFAULT_BACKUP_DIR = "/var/backups/taximetro";
const DEFAULT_BACKUP_PREFIX = "taximetro";
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_SMTP_FROM = "Taximetro Digital <noreply@mnrs.com.br>";

function parsePositiveInteger(value, fallback) {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
    if (value == null || value === "") return fallback;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
}

function parseCsv(value) {
    return (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function sanitizePrefix(value) {
    const sanitized = (value ?? DEFAULT_BACKUP_PREFIX).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-");
    return sanitized.replace(/^-|-$/g, "") || DEFAULT_BACKUP_PREFIX;
}

function sanitizeS3Prefix(value) {
    return (value ?? "")
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join("/");
}

function maskValue(value) {
    if (!value) return null;
    if (value.length <= 4) return "***";
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function maskEmail(email) {
    const [local, domain] = email.split("@");
    if (!domain) return maskValue(email);
    const safeLocal = local.length <= 2 ? "***" : `${local.slice(0, 2)}***`;
    return `${safeLocal}@${domain}`;
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function localTimestamp(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join("") + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function parseDatabaseInfo(connectionString) {
    try {
        const parsed = new URL(connectionString);
        return {
            host: parsed.hostname,
            port: Number.parseInt(parsed.port || "5432", 10),
            database: parsed.pathname.replace(/^\//, "") || "postgres",
            user: parsed.username ? maskValue(decodeURIComponent(parsed.username)) : null,
        };
    } catch {
        return {
            host: "unknown",
            port: null,
            database: "unknown",
            user: null,
        };
    }
}

function log(message, details = undefined) {
    if (details) {
        console.info(`[db-backup] ${message}`, details);
        return;
    }

    console.info(`[db-backup] ${message}`);
}

async function runPgDump({ databaseUrl, backupPath }) {
    await new Promise((resolve, reject) => {
        const child = spawn(
            "pg_dump",
            [
                "--format=custom",
                "--no-owner",
                "--no-privileges",
                `--file=${backupPath}`,
                `--dbname=${databaseUrl}`,
            ],
            {
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );

        let stderr = "";

        child.stdout.on("data", (chunk) => {
            process.stdout.write(chunk);
        });

        child.stderr.on("data", (chunk) => {
            const text = chunk.toString();
            stderr += text;
            process.stderr.write(chunk);
        });

        child.on("error", (error) => {
            reject(error);
        });

        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(stderr.trim() || `pg_dump terminou com codigo ${code}`));
        });
    });
}

async function cleanupOldBackups({ backupDir, prefix, retentionDays }) {
    const deletedFiles = [];
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const allowedSuffixes = [".dump", ".dump.json", ".html"];

    for (const entry of await readdir(backupDir)) {
        if (!entry.startsWith(`${prefix}-`)) continue;
        if (!allowedSuffixes.some((suffix) => entry.endsWith(suffix))) continue;

        const fullPath = path.join(backupDir, entry);
        const info = await stat(fullPath);

        if (info.mtimeMs >= cutoff) continue;

        await unlink(fullPath);
        deletedFiles.push(entry);
    }

    return deletedFiles.sort((left, right) => left.localeCompare(right));
}

function getSmtpConfig() {
    const host = process.env.SMTP_HOST?.trim();
    const portRaw = process.env.SMTP_PORT?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM?.trim() || DEFAULT_SMTP_FROM;

    if (!host || !portRaw || !user || !pass) {
        throw new Error("SMTP_HOST, SMTP_PORT, SMTP_USER e SMTP_PASS precisam estar definidos para enviar o backup por e-mail.");
    }

    const port = Number.parseInt(portRaw, 10);
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error("SMTP_PORT invalido para envio do backup por e-mail.");
    }

    return {
        host,
        port,
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
        requireTls: process.env.SMTP_REQUIRE_TLS === "true",
        rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
        user,
        pass,
        from,
    };
}

function getS3Config() {
    const bucket = process.env.DB_BACKUP_S3_BUCKET?.trim();
    const enabled = parseBoolean(process.env.DB_BACKUP_S3_ENABLED, Boolean(bucket));

    if (!enabled) {
        return null;
    }

    if (!bucket) {
        throw new Error("DB_BACKUP_S3_BUCKET precisa estar definido para enviar o backup ao S3.");
    }

    const region = process.env.DB_BACKUP_S3_REGION?.trim() || process.env.AWS_REGION?.trim() || "us-east-1";
    const endpoint = process.env.DB_BACKUP_S3_ENDPOINT?.trim() || undefined;
    const keyPrefix = sanitizeS3Prefix(process.env.DB_BACKUP_S3_PREFIX);
    const forcePathStyle = parseBoolean(process.env.DB_BACKUP_S3_FORCE_PATH_STYLE, false);

    return {
        bucket,
        region,
        endpoint,
        keyPrefix,
        forcePathStyle,
    };
}

function buildS3Key(prefix, filename) {
    return prefix ? `${prefix}/${filename}` : filename;
}

async function uploadFileToS3({ client, bucket, key, filePath, contentType, PutObjectCommandCtor }) {
    await client.send(new PutObjectCommandCtor({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: contentType,
    }));
}

async function uploadBackupToS3({ attachmentPath, metadataPath, s3Config, summary }) {
    const { PutObjectCommand, S3Client } = await import("@aws-sdk/client-s3");

    const client = new S3Client({
        region: s3Config.region,
        endpoint: s3Config.endpoint,
        forcePathStyle: s3Config.forcePathStyle,
    });

    const backupKey = buildS3Key(s3Config.keyPrefix, summary.filename);
    const metadataKey = `${backupKey}.json`;

    await uploadFileToS3({
        client,
        bucket: s3Config.bucket,
        key: backupKey,
        filePath: attachmentPath,
        contentType: "application/octet-stream",
        PutObjectCommandCtor: PutObjectCommand,
    });

    await uploadFileToS3({
        client,
        bucket: s3Config.bucket,
        key: metadataKey,
        filePath: metadataPath,
        contentType: "application/json",
        PutObjectCommandCtor: PutObjectCommand,
    });

    return {
        bucket: s3Config.bucket,
        region: s3Config.region,
        key: backupKey,
        metadataKey,
        endpoint: s3Config.endpoint ?? null,
    };
}

async function sendBackupEmail({ attachmentPath, metadataPath, recipients, smtpConfig, summary, reportAttachments }) {
    const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        requireTLS: smtpConfig.requireTls,
        auth: {
            user: smtpConfig.user,
            pass: smtpConfig.pass,
        },
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        tls: {
            rejectUnauthorized: smtpConfig.rejectUnauthorized,
        },
    });

    await transporter.verify();

    const subject = `[${summary.prefix}] Backup diario + Relatórios de Presenças`;
    const text = [
        `${summary.appName} - backup diario do banco + relatórios de presenças`,
        "",
        `Backup:`,
        `  Arquivo: ${summary.filename}`,
        `  Tamanho: ${summary.size}`,
        `  Banco: ${summary.database.database} @ ${summary.database.host}:${summary.database.port ?? "?"}`,
        `  Criado em: ${summary.finishedAt}`,
        `  Retencao local: ${summary.retentionDays} dia(s)`,
        "",
        `Relatórios de Presenças:`,
        `  ${reportAttachments.length} faculdade(s) incluída(s)`,
        "",
        "O dump segue em anexo no formato custom do pg_dump (.dump).",
        "Relatórios de presenças em HTML (um por faculdade, optimizado para impressão/PDF).",
        "Para restaurar backup: sh scripts/restore-db-backup.sh /caminho/do/arquivo.dump",
    ].join("\n");

    const attachments = [
        {
            filename: path.basename(attachmentPath),
            path: attachmentPath,
        },
        {
            filename: path.basename(metadataPath),
            path: metadataPath,
            contentType: "application/json",
        },
    ];

    // Add report attachments
    for (const report of reportAttachments) {
        attachments.push({
            filename: path.basename(report.htmlPath),
            path: report.htmlPath,
            contentType: "text/html; charset=utf-8",
            contentDisposition: "attachment",
        });
    }

    await transporter.sendMail({
        from: smtpConfig.from,
        to: recipients,
        subject,
        text,
        attachments,
    });
}

async function main() {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
        throw new Error("DATABASE_URL nao configurada.");
    }

    const backupDir = process.env.DB_BACKUP_DIR?.trim() || DEFAULT_BACKUP_DIR;
    const prefix = sanitizePrefix(process.env.DB_BACKUP_PREFIX);
    const retentionDays = parsePositiveInteger(process.env.DB_BACKUP_RETENTION_DAYS, DEFAULT_RETENTION_DAYS);
    const recipients = parseCsv(process.env.DB_BACKUP_EMAIL_TO);
    const s3Config = getS3Config();
    const appName = process.env.DB_BACKUP_APP_NAME?.trim() || "Taximetro Digital";
    const timezone = process.env.TZ ?? process.env.DB_BACKUP_TZ ?? "UTC";
    const startedAt = new Date();
    const filename = `${prefix}-${localTimestamp(startedAt)}.dump`;
    const backupPath = path.join(backupDir, filename);
    const metadataPath = `${backupPath}.json`;
    const database = parseDatabaseInfo(databaseUrl);

    await mkdir(backupDir, { recursive: true });

    log("Iniciando backup diario.", {
        backupDir,
        prefix,
        retentionDays,
        timezone,
        database,
        emailRecipients: recipients.map((recipient) => maskEmail(recipient)),
        s3: s3Config
            ? {
                bucket: s3Config.bucket,
                region: s3Config.region,
                keyPrefix: s3Config.keyPrefix || null,
                endpoint: s3Config.endpoint ?? null,
            }
            : { status: "disabled" },
    });

    await runPgDump({ databaseUrl, backupPath });

    const info = await stat(backupPath);
    const finishedAt = new Date();
    const deletedFiles = await cleanupOldBackups({ backupDir, prefix, retentionDays });

    const summary = {
        appName,
        prefix,
        filename,
        backupPath,
        metadataPath,
        sizeBytes: info.size,
        size: formatBytes(info.size),
        createdAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        retentionDays,
        timezone,
        database,
        email: recipients.length > 0
            ? {
                recipients: recipients.map((recipient) => maskEmail(recipient)),
                status: "pending",
            }
            : {
                recipients: [],
                status: "disabled",
            },
        s3: s3Config
            ? {
                bucket: s3Config.bucket,
                region: s3Config.region,
                keyPrefix: s3Config.keyPrefix || null,
                endpoint: s3Config.endpoint ?? null,
                status: "pending",
            }
            : {
                status: "disabled",
            },
        cleanup: {
            deletedFiles,
        },
    };

    await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

    const deliveryErrors = [];
    let reportAttachments = [];

    // Generate attendance reports
    try {
        reportAttachments = await generateAttendanceReports(databaseUrl);
        const reportTimestamp = filename.replace(/\.dump$/i, "");

        for (const report of reportAttachments) {
            const safeFaculty = sanitizeFilePart(report.facultyAbbr);
            const htmlPath = path.join(backupDir, `${reportTimestamp}-relatorio-${safeFaculty}.html`);

            await writeFile(htmlPath, report.html, "utf8");

            report.htmlPath = htmlPath;
        }

        if (reportAttachments.length > 0) {
            log("Relatórios de presenças gerados.", {
                faculties: reportAttachments.map((report) => report.facultyAbbr),
            });

            summary.reports = reportAttachments.map((report) => ({
                faculty: report.facultyAbbr,
                htmlPath: report.htmlPath,
            }));
            await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
        }
    } catch (error) {
        console.warn(`[db-backup] Warning: Failed to generate reports - ${error instanceof Error ? error.message : String(error)}`);
    }

    if (recipients.length > 0) {
        try {
            const smtpConfig = getSmtpConfig();
            await sendBackupEmail({
                attachmentPath: backupPath,
                metadataPath,
                recipients,
                smtpConfig,
                summary,
                reportAttachments,
            });
            summary.email.status = "sent";
            await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
            log("Backup enviado por e-mail.", {
                recipients: summary.email.recipients,
                filename,
            });
        } catch (error) {
            summary.email.status = "failed";
            summary.email.error = error instanceof Error ? error.message : String(error);
            await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
            deliveryErrors.push(new Error(`envio por e-mail falhou: ${summary.email.error}`));
        }
    }

    if (s3Config) {
        try {
            const uploaded = await uploadBackupToS3({
                attachmentPath: backupPath,
                metadataPath,
                s3Config,
                summary,
            });
            summary.s3 = {
                ...summary.s3,
                ...uploaded,
                status: "uploaded",
            };
            await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
            log("Backup enviado ao S3.", {
                bucket: uploaded.bucket,
                key: uploaded.key,
                metadataKey: uploaded.metadataKey,
            });
        } catch (error) {
            summary.s3.status = "failed";
            summary.s3.error = error instanceof Error ? error.message : String(error);
            await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
            deliveryErrors.push(new Error(`upload S3 falhou: ${summary.s3.error}`));
        }
    }

    if (recipients.length === 0 && !s3Config) {
        log("Backup salvo localmente; envios remotos desabilitados.", {
            backupPath,
            metadataPath,
        });
    }

    if (deliveryErrors.length > 0) {
        throw new Error(deliveryErrors.map((error) => error.message).join(" | "));
    }

    log("Backup concluido com sucesso.", {
        filename,
        size: summary.size,
        deletedFiles,
    });
}

main().catch((error) => {
    console.error("[db-backup] Falha no backup diario.", {
        error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
});