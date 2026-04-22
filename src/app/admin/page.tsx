import { AdminDashboardClient } from "@/components/admin-dashboard";
import { localDateStr, operationalDateStr, operationalPeriod } from "@/lib/utils";
import { fetchDashboardData } from "@/features/reporting/infra/repositories/dashboard-query";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  try {
    return await AdminDashboardContent();
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

async function AdminDashboardContent() {
  const today = operationalDateStr();
  const calendarToday = localDateStr();
  const currentPeriod = operationalPeriod();

  const data = await fetchDashboardData(today, calendarToday, currentPeriod);
  return <AdminDashboardClient data={data} />;
}
