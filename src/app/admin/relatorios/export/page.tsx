import { headers } from "next/headers";
import { AttendanceReportDocument } from "@/components/reports/attendance-report-document";
import { ReportAutoPrint } from "@/components/reports/report-auto-print";
import { generateAdminReport } from "@/lib/admin-report-builder";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { reportFilterInputSchema, reportFormatSchema } from "@/lib/report-filters";

export const dynamic = "force-dynamic";

type SearchParamsShape = Promise<{ format?: string; filters?: string }>;

function decodeFilters(encoded: string | undefined) {
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export default async function AdminRelatoriosExportPage({ searchParams }: { searchParams: SearchParamsShape }) {
  const session = await auth();
  if (!session || session.user.role !== "COORDINATOR") {
    return <div className="p-8 text-sm text-rose-700">Sem permissão para exportar relatórios.</div>;
  }

  const resolved = await searchParams;
  const formatParsed = reportFormatSchema.safeParse(resolved.format ?? "html");
  const filtersParsed = reportFilterInputSchema.safeParse(decodeFilters(resolved.filters));

  if (!formatParsed.success || !filtersParsed.success || formatParsed.data === "json") {
    return <div className="p-8 text-sm text-rose-700">Parâmetros de exportação inválidos.</div>;
  }

  const { document } = await generateAdminReport(filtersParsed.data);
  const headerStore = await headers();
  const ipAddress = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || headerStore.get("x-real-ip") || undefined;

  await logAudit({
    userId: session.user.id,
    action: "report.generated",
    entity: "report",
    payload: {
      format: formatParsed.data,
      filters: filtersParsed.data,
      transport: formatParsed.data === "pdf" ? "browser-print" : "html-page",
    },
    ipAddress,
  });

  return (
    <div className="min-h-screen bg-white">
      {formatParsed.data === "pdf" ? <ReportAutoPrint /> : null}
      <AttendanceReportDocument document={document} />
    </div>
  );
}