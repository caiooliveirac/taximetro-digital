#!/usr/bin/env node

/**
 * Script de teste para gerar e visualizar os relatórios de presenças
 * Uso: npm run test:attendance-reports
 */

import fetch from "node:fetch";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FACULTY_COLORS = {
    EBMSP: { bg: "#d1fae5", text: "#065f46", emoji: "🟢" },
    UFBA: { bg: "#fed7aa", text: "#92400e", emoji: "🟠" },
    UNIFACS: { bg: "#fef3c7", text: "#92400e", emoji: "🟡" },
    ZARNS: { bg: "#bfdbfe", text: "#0c2d6b", emoji: "🔵" },
    AFYA: { bg: "#fbcfe8", text: "#831843", emoji: "🔴" },
};

const STATUS_ICONS = {
    SCHEDULED: { emoji: "📅", label: "Agendado", color: "#fbbf24" },
    CONFIRMED: { emoji: "✅", label: "Confirmado", color: "#10b981" },
    CHECKED_IN: { emoji: "🔵", label: "Presente", color: "#3b82f6" },
    CHECKED_OUT: { emoji: "✓", label: "Finalizado", color: "#10b981" },
    ABSENT: { emoji: "❌", label: "Ausente", color: "#ef4444" },
    CANCELLED: { emoji: "⊘", label: "Cancelado", color: "#6b7280" },
};

const PERIOD_ICONS = { DAY: "☀️", NIGHT: "🌙" };

function formatDate(dateStr) {
    const date = new Date(dateStr + "T12:00:00");
    return new Intl.DateTimeFormat("pt-BR", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
    }).format(date);
}

function formatTime(isoTime) {
    if (!isoTime) return "—";
    try {
        const date = new Date(isoTime);
        return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    } catch {
        return "—";
    }
}

function generateAttendanceReportHTML(faculty) {
    const facultyColor = FACULTY_COLORS[faculty.facultyAbbr] || { bg: "#f3f4f6", text: "#374151", emoji: "⚪" };
    const generatedDate = new Date(faculty.generatedAt).toLocaleString("pt-BR");
    const activeInterns = faculty.interns.filter(i => !i.isArchived);

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatório - ${faculty.facultyAbbr}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; line-height: 1.5; }
    .container { max-width: 900px; margin: 0 auto; padding: 20px; }
    .header { background-color: ${facultyColor.bg}; border-left: 4px solid ${facultyColor.text}; padding: 20px; margin-bottom: 24px; border-radius: 8px; }
    .header h1 { font-size: 24px; color: ${facultyColor.text}; margin-bottom: 8px; }
    .header-meta { font-size: 12px; color: ${facultyColor.text}99; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .stat-card { background: white; padding: 12px; border-radius: 6px; border-left: 3px solid ${facultyColor.text}; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .stat-value { font-size: 20px; font-weight: 600; color: ${facultyColor.text}; }
    .intern-section { background: white; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .intern-header { background: ${facultyColor.bg}; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
    .intern-name { font-weight: 600; color: ${facultyColor.text}; font-size: 14px; }
    .intern-stats { display: flex; gap: 16px; font-size: 12px; }
    .intern-stat { display: flex; align-items: center; gap: 4px; padding: 2px 8px; background: white; border-radius: 4px; }
    .assignment-list { padding: 12px 16px; }
    .assignment-item { padding: 10px; margin-bottom: 8px; border-radius: 6px; background: #f8fafc; border-left: 3px solid #e2e8f0; font-size: 13px; }
    .assignment-item.present { background: #f0fdf4; border-left-color: #10b981; }
    .assignment-item.absent { background: #fef2f2; border-left-color: #ef4444; }
    .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 500; background: #e8e8e8; color: #374151; margin-right: 4px; }
    .absence-item { padding: 8px; margin-top: 8px; background: #fffbeb; border-left: 2px solid #f59e0b; border-radius: 4px; font-size: 12px; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${facultyColor.emoji} ${faculty.facultyAbbr} - Relatório de Presenças</h1>
      <div class="header-meta">Gerado em ${generatedDate} | Últimos 30 dias</div>
    </div>
    <div class="stats-row">
      <div class="stat-card"><div class="stat-label">Total de Internos</div><div class="stat-value">${activeInterns.length}</div></div>
      <div class="stat-card"><div class="stat-label">Total de Plantões</div><div class="stat-value">${activeInterns.reduce((sum, i) => sum + i.assignments.length, 0)}</div></div>
      <div class="stat-card"><div class="stat-label">Presentes</div><div class="stat-value">${activeInterns.reduce((sum, i) => sum + (i.stats.totalCheckedOut + i.stats.totalCheckedIn), 0)}</div></div>
      <div class="stat-card"><div class="stat-label">Ausências</div><div class="stat-value">${activeInterns.reduce((sum, i) => sum + i.stats.totalAbsent, 0)}</div></div>
    </div>
    ${activeInterns.map(intern => `
      <div class="intern-section">
        <div class="intern-header">
          <div class="intern-name">${intern.internName}</div>
          <div class="intern-stats">
            <div class="intern-stat"><span>USA:</span><strong>${intern.stats.totalUSAs}</strong></div>
            <div class="intern-stat"><span>Presentes:</span><strong style="color: #10b981">${intern.stats.totalCheckedOut}</strong></div>
            <div class="intern-stat"><span>Ausências:</span><strong style="color: #ef4444">${intern.stats.totalAbsent}</strong></div>
          </div>
        </div>
        <div class="assignment-list">
          ${intern.assignments.length === 0 ? '<div style="color: #94a3b8; font-size: 12px;">Nenhum plantão no período</div>' : intern.assignments.map(a => {
            const status = STATUS_ICONS[a.status] || STATUS_ICONS.SCHEDULED;
            const period = PERIOD_ICONS[a.period] || "";
            let itemClass = "assignment-item";
            if (a.status === "CHECKED_OUT" || a.status === "CHECKED_IN") itemClass += " present";
            else if (a.status === "ABSENT") itemClass += " absent";
            return `<div class="${itemClass}">
              <div><strong>${formatDate(a.date)}</strong> <span class="badge">${period}</span> <span class="badge">${a.baseCode}</span> <span class="badge" style="background: ${status.color}22; color: ${status.color};">${status.emoji} ${status.label}</span></div>
              <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${a.baseName}${a.shift ? ` • ${a.shift === "MORNING" ? "Manhã" : "Tarde"}` : ""}</div>
              ${a.checkinAt || a.checkoutAt ? `<div style="font-size: 12px; color: #64748b; margin-top: 4px;">${a.checkinAt ? `✓ Check-in: ${formatTime(a.checkinAt)}` : ""} ${a.checkoutAt ? `✓ Check-out: ${formatTime(a.checkoutAt)}` : ""}</div>` : ""}
              ${a.status === "ABSENT" && a.isJustified ? `<div class="absence-item">✓ Justificada${a.absenceJustification ? ` - "${a.absenceJustification}"` : ""}</div>` : a.status === "ABSENT" && !a.isJustified ? `<div class="absence-item">⚠️ Não justificada</div>` : ""}
            </div>`;
          }).join("")}
        </div>
      </div>
    `).join("")}
    <div class="footer">
      <p>Relatório automatizado do Taxímetro Digital</p>
      <p>Para informações detalhadas, acesse o dashboard administrativo</p>
    </div>
  </div>
</body>
</html>`;
}

async function main() {
    const apiUrl = process.env.APP_URL || "http://localhost:3000";
    const demoUrl = `${apiUrl}/taximetro/api/report/daily-attendance-by-faculty-demo`;

    console.log(`\n📊 Teste de Relatórios de Presenças`);
    console.log(`Fetchando dados de demo em: ${demoUrl}\n`);

    try {
        const response = await fetch(demoUrl);
        if (!response.ok) throw new Error(`API returned ${response.status}`);

        const data = await response.json();
        if (!data.success || !data.data) throw new Error("Invalid API response");

        console.log(`✓ ${data.data.length} faculdade(s) recebida(s)\n`);

        const htmlReports = [];
        for (const faculty of data.data) {
            const html = generateAttendanceReportHTML(faculty);
            htmlReports.push({ facultyAbbr: faculty.facultyAbbr, html });
            console.log(`✓ Relatório gerado: ${faculty.facultyAbbr}`);
        }

        console.log(`\nSalvando relatórios em ./tmp-reports/...\n`);
        for (const { facultyAbbr, html } of htmlReports) {
            const filename = `/tmp/relatorio-presencas-${facultyAbbr}-demo.html`;
            await writeFile(filename, html, "utf8");
            console.log(`  📄 ${filename}`);
        }

        console.log(`\nRelatórios gerados com sucesso!`);
        console.log(`Para visualizar, abra um dos arquivos em seu navegador.\n`);
    } catch (error) {
        console.error(`✗ Erro: ${error.message}`);
        process.exit(1);
    }
}

main();
