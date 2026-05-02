import { AdminDashboardClient } from "@/components/admin-dashboard";
import { localDateStr, operationalDateStr, operationalPeriod } from "@/lib/utils";
import { fetchDashboardData } from "@/features/reporting/infra/repositories/dashboard-query";
import { buildCockpitData, fetchNoCheckinNow } from "@/features/reporting/application/build-cockpit";
import { executeGetComplianceOverview } from "@/features/compliance/application/use-cases/get-compliance-overview";
import { listFaculties } from "@/features/faculties/infra/repositories/faculty-repository";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

type SearchParamsShape = Promise<{ faculty?: string }>;

export default async function AdminDashboard({ searchParams }: { searchParams: SearchParamsShape }) {
  try {
    return await AdminDashboardContent({ searchParams });
  } catch (err) {
    console.error("[Admin] Dashboard error:", err);
    return <AdminDashboardError message={err instanceof Error ? err.message : "Erro desconhecido"} />;
  }
}

function AdminDashboardError({ message }: { message: string }) {
  const isDbError = message.includes("ECONNREFUSED") || message.includes("connect") || message.includes("timeout");
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <h2 className="mb-2 text-lg font-semibold text-red-800">
          {isDbError ? "Banco de dados indisponível" : "Erro ao carregar dashboard"}
        </h2>
        <p className="mb-4 text-sm text-red-600">
          {isDbError
            ? "Não foi possível conectar ao banco de dados. Verifique se o PostgreSQL está em execução."
            : "Ocorreu um erro inesperado ao carregar os dados."}
        </p>
        <a href="/taximetro/admin" className="inline-block rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
          Tentar novamente
        </a>
      </div>
    </div>
  );
}

async function AdminDashboardContent({ searchParams }: { searchParams: SearchParamsShape }) {
  const today = operationalDateStr();
  const calendarToday = localDateStr();
  const currentPeriod = operationalPeriod();

  const session = await auth();
  const sessionUser = session?.user as
    | { id?: string; role?: string; facultyId?: string | null }
    | undefined;

  const resolvedParams = await searchParams;
  const facultyFilter = resolvedParams.faculty ?? null;

  const [dashboardData, compliance, faculties] = await Promise.all([
    fetchDashboardData(today, calendarToday, currentPeriod),
    executeGetComplianceOverview({
      actor: {
        id: sessionUser?.id ?? "",
        role: sessionUser?.role ?? "COORDINATOR",
        facultyId: sessionUser?.facultyId ?? null,
      },
    }),
    listFaculties(),
  ]);

  const noCheckinRows = await fetchNoCheckinNow();
  const cockpit = buildCockpitData({
    complianceInterns: compliance.data,
    noCheckinRows,
  });

  const facultyOptions = faculties
    .filter((f) => !f.isVirtual)
    .map((f) => ({ id: f.id, abbreviation: f.abbreviation, name: f.name }));

  return (
    <AdminDashboardClient
      data={dashboardData}
      cockpit={cockpit}
      facultyOptions={facultyOptions}
      facultyFilter={facultyFilter}
    />
  );
}
