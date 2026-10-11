import { localDateStr } from "@/lib/utils";
import { logAudit } from "@/shared/infra/logger/audit";
import { generateAdminReport } from "@/lib/admin-report-builder";
import { buildCohortReportFilters } from "@/lib/report-filters";
import { encodeReportFilters, fetchReportHtmlForEmail } from "@/lib/report-export-html";
import { getEmailErrorSummary, sendCohortClosingReportEmail } from "@/lib/email";
import {
  listCohortsForLifecycle,
  activateCohort,
  closeCohort,
  archiveInternRoles,
  listActiveInternsWithLastShift,
  getCohortLastShiftDate,
  listCohortsPendingClosingReport,
  listCohortLeaderNames,
  markClosingReportSent,
} from "@/features/cohorts/infra/repositories/cohort-repository";
import { planCohortClosure, type ClosureIntern } from "@/features/cohorts/domain/cohort-closure";

export type CohortLifecycleResult = {
  today: string;
  activated: Array<{ cohortId: string; label: string }>;
  closed: Array<{ cohortId: string; label: string; archivedInterns: number }>;
  /** Turma vencida que segue aberta porque há interno com plantão de hoje em diante. */
  held: Array<{
    cohortId: string;
    label: string;
    endDate: string;
    archivedInterns: number;
    pending: Array<{ name: string; lastShiftDate: string }>;
  }>;
};

/**
 * Avalia as datas de início/fim das turmas e aplica transições de status:
 *  - PLANNED com startDate <= hoje  → ACTIVE
 *  - turma com endDate < hoje → arquiva cada interno que não tem mais plantão
 *    de hoje em diante; quem tem (reposição escalada depois do fim) fica ativo
 *    e é arquivado na primeira rodada depois do último plantão. A turma vira
 *    CLOSED quando o último interno é arquivado; até lá aparece em `held`.
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

  const result: CohortLifecycleResult = { today, activated: [], closed: [], held: [] };

  const endedIds = cohorts.filter((cohort) => cohort.endDate < today).map((cohort) => cohort.id);
  const internsByCohort = new Map<string, ClosureIntern[]>();
  for (const intern of await listActiveInternsWithLastShift(endedIds)) {
    const list = internsByCohort.get(intern.cohortId) ?? [];
    list.push(intern);
    internsByCohort.set(intern.cohortId, list);
  }

  for (const cohort of cohorts) {
    const plan = planCohortClosure({
      endDate: cohort.endDate,
      today,
      interns: internsByCohort.get(cohort.id) ?? [],
    });

    // Fim já passou → arquiva quem não tem mais plantão (vale para PLANNED ou ACTIVE).
    if (plan.ended) {
      const archivedInterns = await archiveInternRoles(plan.toArchive.map((i) => i.userRoleId), actorUserId);
      const pending = plan.pending.map((i) => ({ name: i.name, lastShiftDate: i.lastShiftDate! }));

      if (plan.closeCohort) {
        await closeCohort(cohort.id, actorUserId);
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

      console.warn("[cohort-lifecycle] turma passou do fim mas tem interno com plantão por vir; segue aberta", {
        cohortId: cohort.id, label: cohort.label, endDate: cohort.endDate, archivedInterns, pending,
      });
      result.held.push({ cohortId: cohort.id, label: cohort.label, endDate: cohort.endDate, archivedInterns, pending });
      if (archivedInterns > 0) {
        await logAudit({
          userId: actorUserId ?? undefined,
          action: "AUTO_ARCHIVE_COHORT_INTERNS",
          entity: "cohort",
          entityId: cohort.id,
          payload: { endDate: cohort.endDate, today, archivedInterns, pending },
        });
      }
      // Turma vencida ainda PLANNED (cadastrada atrasada) também vira ACTIVE abaixo.
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
      // Reposição escalada depois do fim entra no relatório.
      const filters = buildCohortReportFilters({ ...cohort, lastShiftDate: await getCohortLastShiftDate(cohort.id) });
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
