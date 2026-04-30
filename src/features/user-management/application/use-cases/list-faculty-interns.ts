import { listFacultyInternRows } from "@/features/user-management/infra/repositories/user-management-repository";

export async function executeListFacultyInterns(facultyId: string, cohortId?: string | null) {
  const rows = await listFacultyInternRows(facultyId, cohortId);

  const deduped = new Map<string, { id: string; name: string; userActive: boolean; roleActive: boolean; isArchived: boolean }>();
  for (const row of rows) {
    const existing = deduped.get(row.id);
    if (!existing) {
      deduped.set(row.id, row);
      continue;
    }

    deduped.set(row.id, {
      ...existing,
      userActive: existing.userActive || row.userActive,
      roleActive: existing.roleActive || row.roleActive,
      isArchived: existing.isArchived && row.isArchived,
    });
  }

  return [...deduped.values()];
}
