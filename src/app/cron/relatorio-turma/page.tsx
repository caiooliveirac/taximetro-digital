import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AttendanceReportDocument } from "@/components/reports/attendance-report-document";
import { generateAdminReport } from "@/lib/admin-report-builder";
import { reportFilterInputSchema } from "@/lib/report-filters";
import { decodeReportFilters } from "@/lib/report-export-html";

export const dynamic = "force-dynamic";

/**
 * Relatório renderizado para o próprio servidor anexar no e-mail de turma
 * encerrada (cron sem sessão). Só responde a quem manda `x-cron-key` igual ao
 * AUTH_SECRET; para o resto, a rota não existe.
 */
export default async function CronRelatorioTurmaPage({
  searchParams,
}: {
  searchParams: Promise<{ filters?: string }>;
}) {
  const headerStore = await headers();
  const secret = process.env.AUTH_SECRET;
  if (!secret || headerStore.get("x-cron-key") !== secret) notFound();

  const filtersParsed = reportFilterInputSchema.safeParse(decodeReportFilters((await searchParams).filters));
  if (!filtersParsed.success) notFound();

  const { document } = await generateAdminReport(filtersParsed.data);

  return (
    <div className="min-h-screen bg-white">
      <AttendanceReportDocument document={document} />
    </div>
  );
}
