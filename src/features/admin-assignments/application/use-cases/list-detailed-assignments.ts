import { listDetailedAssignmentsByDateRange } from "@/features/admin-assignments/infra/repositories/admin-assignments-repository";

export async function executeListDetailedAssignments(params: {
  from: string | null;
  to: string | null;
}) {
  if (!params.from || !params.to) {
    return {
      status: 400,
      body: { success: false, error: "Parâmetros from e to são obrigatórios" },
    } as const;
  }

  const rows = await listDetailedAssignmentsByDateRange({ from: params.from, to: params.to });
  return { status: 200, body: { success: true, data: rows } } as const;
}
