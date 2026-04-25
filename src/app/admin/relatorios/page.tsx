import { AdminReportsExplorer } from "@/components/admin/admin-reports-explorer";
import { listReportCatalog } from "@/lib/admin-report-builder";

export const dynamic = "force-dynamic";

export default async function AdminRelatoriosPage() {
  const catalog = await listReportCatalog();
  return <AdminReportsExplorer catalog={catalog} />;
}
