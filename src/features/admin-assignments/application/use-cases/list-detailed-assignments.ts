import {
  getDetailedAssignmentById,
  listDetailedAssignmentsByDateRange,
} from "@/features/admin-assignments/infra/repositories/admin-assignments-repository";

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

export async function executeGetDetailedAssignmentById(params: { id: string | null }) {
  if (!params.id) {
    return {
      status: 400,
      body: { success: false, error: "Parâmetro id é obrigatório" },
    } as const;
  }

  const rows = await getDetailedAssignmentById({ id: params.id });
  const assignment = rows[0] ?? null;

  if (!assignment) {
    return {
      status: 404,
      body: { success: false, error: "Plantão não encontrado" },
    } as const;
  }

  return {
    status: 200,
    body: { success: true, data: assignment },
  } as const;
}
