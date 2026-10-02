import { localDateStr } from "@/lib/utils";
import { logAudit } from "@/shared/infra/logger/audit";
import { generateAdminReport } from "@/lib/admin-report-builder";
import { buildCohortReportFilters } from "@/lib/report-filters";
import { encodeReportFilters, fetchReportHtmlForEmail } from "@/lib/report-export-html";
import { getEmailErrorSummary, sendCohortClosingReportEmail } from "@/lib/email";
import {
  listCohortsForLifecycle,
  activateCohort,
  closeCohortAndArchiveInterns,
  listCohortsPendingClosingReport,
  listCohortLeaderNames,
  markClosingReportSent,
} from "@/features/cohorts/infra/repositories/cohort-repository";

export type CohortLifecycleResult = {
  today: string;
  activated: Array<{ cohortId: string; label: string }>;
  closed: Array<{ cohortId: string; label: string; archivedInterns: number }>;
};

/**
 * Avalia as datas de início/fim das turmas e aplica transições de status:
 *  - PLANNED com startDate <= hoje  → ACTIVE
 *  - qualquer turma com endDate < hoje → CLOSED + arquiva todos os internos
 *
 * Idempotente: roda diariamente via cron e também sob demanda ao salvar datas
 * de uma turma. Passe `cohortId` para avaliar apenas uma turma.
 *
 * `actorUserId` é gravado em closed_by/archived_by; o cron passa `null`.
 */
export async function evaluateCohortLifecycle(params?: {
  cohortId?: string;
  actorUserId?: string | null;
}): Promise<CohortLifecycleResult> {
  const today = localDateStr();
  const actorUserId = params?.actorUserId ?? null;
  const cohorts = await listCohortsForLifecycle(params?.cohortId);

  const result: CohortLifecycleResult = { today, activated: [], closed: [] };

  for (const cohort of cohorts) {
    // Fim já passou → fecha e arquiva (vale para PLANNED ou ACTIVE).
    if (cohort.endDate < today) {
      const archivedInterns = await closeCohortAndArchiveInterns({
        cohortId: cohort.id,
        closedBy: actorUserId,
      });
      result.closed.push({ cohortId: cohort.id, label: cohort.label, archivedInterns });
      await logAudit({
        userId: actorUserId ?? undefined,
        action: "AUTO_CLOSE_COHORT",
        entity: "cohort",
        entityId: cohort.id,
        payload: { endDate: cohort.endDate, today, archivedInterns },
      });
      continue;
    }

    // Início já chegou e ainda está PLANNED → ativa.
    if (cohort.status === "PLANNED" && cohort.startDate <= today) {
      await activateCohort(cohort.id);
      result.activated.push({ cohortId: cohort.id, label: cohort.label });
      await logAudit({
        userId: actorUserId ?? undefined,
        action: "AUTO_ACTIVATE_COHORT",
        entity: "cohort",
        entityId: cohort.id,
        payload: { startDate: cohort.startDate, today },
      });
    }
  }

  return result;
}

/** Turma fechada há mais que isso sem relatório enviado fica de fora (não reenvia histórico). */
const CLOSING_REPORT_RETRY_DAYS = 3;

export type ClosingReportResult = {
  sent: Array<{ cohortId: string; label: string; attachmentName: string }>;
  failed: Array<{ cohortId: string; label: string; error: string }>;
  skipped?: string;
};

/**
 * Manda por e-mail o relatório completo de cada turma recém-fechada (pelo cron
 * ou à mão), para o coordenador encaminhar à faculdade. Marca a turma em
 * closing_report_snapshot só quando o envio dá certo, então uma falha de SMTP
 * é tentada de novo nas próximas rodadas do cron, por até 3 dias.
 */
export async function sendPendingClosingReports(): Promise<ClosingReportResult> {
  const result: ClosingReportResult = { sent: [], failed: [] };
  const to = process.env.COHORT_REPORT_EMAIL_TO?.trim() || process.env.DB_BACKUP_EMAIL_TO?.trim();
  const cronKey = process.env.AUTH_SECRET;
  if (!to || !cronKey) {
    result.skipped = "COHORT_REPORT_EMAIL_TO/DB_BACKUP_EMAIL_TO ou AUTH_SECRET ausente";
    return result;
  }

  const since = new Date(Date.now() - CLOSING_REPORT_RETRY_DAYS * 24 * 60 * 60 * 1000);
  const pending = await listCohortsPendingClosingReport(since);

  for (const cohort of pending) {
    try {
      const filters = buildCohortReportFilters(cohort);
      const [{ document }, leaderNames, html] = await Promise.all([
        generateAdminReport(filters),
        listCohortLeaderNames(cohort.id),
        fetchReportHtmlForEmail(
          `/taximetro/cron/relatorio-turma?filters=${encodeReportFilters(filters)}`,
          { "x-cron-key": cronKey },
        ),
      ]);

      const report = {
        facultyName: cohort.facultyName,
        facultyAbbr: cohort.facultyAbbr,
        cohortName: cohort.name ?? cohort.label,
        startDate: cohort.startDate,
        endDate: cohort.endDate,
        leaderNames,
        internCount: document.previewSummary.internCount,
        assignmentCount: document.previewSummary.assignmentCount,
      };
      const { attachmentName } = await sendCohortClosingReportEmail(to, html, report);

      await markClosingReportSent(cohort.id, { ...report, emailedTo: to, emailedAt: new Date().toISOString(), attachmentName });
      await logAudit({
        action: "COHORT_CLOSING_REPORT_EMAILED",
        entity: "cohort",
        entityId: cohort.id,
        payload: { to, attachmentName, internCount: report.internCount, assignmentCount: report.assignmentCount },
      });
      result.sent.push({ cohortId: cohort.id, label: cohort.label, attachmentName });
    } catch (error) {
      const message = error instanceof Error && error.name === "EmailDeliveryError"
        ? getEmailErrorSummary(error).code
        : error instanceof Error ? error.message : String(error);
      console.error("[cohort-lifecycle] relatório de encerramento falhou", { cohortId: cohort.id, message });
      result.failed.push({ cohortId: cohort.id, label: cohort.label, error: message });
    }
  }

  return result;
}
