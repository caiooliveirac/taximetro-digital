import "server-only";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DailyAttendanceByFaculty } from "@/app/api/report/daily-attendance-by-faculty/route";
import { AttendanceReportDocument } from "@/components/reports/attendance-report-document";
import {
  classifyReportAssignment,
  getBahiaContext,
  type ReportDocument,
  type ReportInternDocument,
  type ReportTypeSection,
} from "@/lib/admin-report-builder";
import { DEFAULT_REPORT_FILTERS } from "@/lib/report-filters";

function buildLegacyDocument(faculty: DailyAttendanceByFaculty): ReportDocument {
  const { todayStr, hourNow } = getBahiaContext();

  const interns: ReportInternDocument[] = faculty.interns
    .filter((intern) => !intern.isArchived)
    .map((intern) => {
      const typeSections: Record<"CENTRAL" | "CRL" | "USA", ReportTypeSection> = {
        CENTRAL: {
          key: "CENTRAL",
          label: "CRU",
          icon: "🏥",
          accentColor: "#1d4ed8",
          bgColor: "#eff6ff",
          chipBg: "#dbeafe",
          chipColor: "#1d4ed8",
          done: [],
          scheduled: [],
        },
        CRL: {
          key: "CRL",
          label: "Intervenção / CRL",
          icon: "🏨",
          accentColor: "#7e22ce",
          bgColor: "#faf5ff",
          chipBg: "#f3e8ff",
          chipColor: "#7e22ce",
          done: [],
          scheduled: [],
        },
        USA: {
          key: "USA",
          label: "USA",
          icon: "🚑",
          accentColor: "#b45309",
          bgColor: "#fffbeb",
          chipBg: "#fef3c7",
          chipColor: "#92400e",
          done: [],
          scheduled: [],
        },
      };
      const absences: ReportInternDocument["absences"] = [];

      for (const assignment of intern.assignments) {
        const card = {
          assignmentId: assignment.assignmentId,
          date: assignment.date,
          period: assignment.period,
          baseCode: assignment.baseCode,
          baseName: assignment.baseName,
          baseType: assignment.baseType,
          status: assignment.status,
          shift: assignment.shift,
          checkinAt: assignment.checkinAt,
          checkoutAt: assignment.checkoutAt,
          isJustified: assignment.isJustified,
          absenceJustification: assignment.absenceJustification,
        };
        const group = classifyReportAssignment(card, todayStr, hourNow);
        if (group === "absent") {
          absences.push(card);
        } else {
          const typeKey = assignment.baseType === "CRL" ? "CRL" : assignment.baseType === "USA" ? "USA" : "CENTRAL";
          typeSections[typeKey][group].push(card);
        }
      }

      const completed = Object.values(typeSections).reduce((sum, section) => sum + section.done.length, 0);
      const scheduled = Object.values(typeSections).reduce((sum, section) => sum + section.scheduled.length, 0);

      return {
        internId: intern.internId,
        internName: intern.internName,
        facultyAbbr: faculty.facultyAbbr,
        cohortLabel: "Relatório legado",
        typeSummaryChips: Object.values(typeSections)
          .filter((section) => section.done.length + section.scheduled.length > 0)
          .map((section) => `${section.icon} ${section.label}: ✅${section.done.length}${section.scheduled.length > 0 ? ` 📅${section.scheduled.length}` : ""}`),
        statusSummaryChips: [
          completed > 0 ? `✅ ${completed} cumpridos` : "",
          scheduled > 0 ? `📅 ${scheduled} agendados` : "",
          absences.length > 0 ? `⚠️ ${absences.length} ausências` : "",
        ].filter(Boolean),
        typeSections: Object.values(typeSections),
        absences,
        progress: {
          targetHours: 0,
          completedHours: completed * 12,
          targetShifts: 0,
          completedShifts: completed,
          percentHours: null,
          percentShifts: null,
          isAboveTarget: false,
        },
        metrics: {
          completed,
          scheduled,
          absences: absences.length,
          pendingRequests: 0,
          rejectedRequests: 0,
          noCheckinInPeriod: completed === 0 && scheduled === 0 && absences.length === 0,
        },
        caseRecordGroups: [],
        requests: [],
      };
    });

  const totalCompleted = interns.reduce((sum, intern) => sum + intern.metrics.completed, 0);
  const totalScheduled = interns.reduce((sum, intern) => sum + intern.metrics.scheduled, 0);
  const totalAbsences = interns.reduce((sum, intern) => sum + intern.metrics.absences, 0);

  return {
    generatedAt: faculty.generatedAt,
    periodLabel: "Últimos 30 dias",
    scopeLabel: faculty.facultyAbbr,
    facultyLabel: faculty.facultyAbbr,
    filters: {
      ...DEFAULT_REPORT_FILTERS,
      display: {
        ...DEFAULT_REPORT_FILTERS.display,
        includeCover: true,
      },
    },
    warnings: [],
    previewSummary: {
      internCount: interns.length,
      assignmentCount: totalCompleted + totalScheduled + totalAbsences,
    },
    cover: {
      totalHours: totalCompleted * 12,
      totalCompleted,
      totalScheduled,
      totalAbsences,
      totalCruCompleted: interns.reduce((sum, intern) => sum + (intern.typeSections.find((section) => section.key === "CENTRAL")?.done.length ?? 0), 0),
      totalCrlCompleted: interns.reduce((sum, intern) => sum + (intern.typeSections.find((section) => section.key === "CRL")?.done.length ?? 0), 0),
      totalUsaCompleted: interns.reduce((sum, intern) => sum + (intern.typeSections.find((section) => section.key === "USA")?.done.length ?? 0), 0),
      belowTargetInterns: [],
      comparison: [],
      heatmapDays: [],
      heatmapRows: [],
    },
    interns,
  };
}

export function renderAttendanceReportHTML(document: ReportDocument, autoPrint = false): string {
  const markup = renderToStaticMarkup(createElement(AttendanceReportDocument, { document }));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Relatório de Plantões</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f8fafc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    @media print {
      body { background: white; }
    }
  </style>
  ${autoPrint ? '<script>window.addEventListener("load", () => window.print());</script>' : ""}
</head>
<body>${markup}</body>
</html>`;
}

export function generateFacultyAttendanceHTML(faculty: DailyAttendanceByFaculty): string {
  return renderAttendanceReportHTML(buildLegacyDocument(faculty));
}

export function generateHTMLPreview(html: string): string {
  return html;
}
