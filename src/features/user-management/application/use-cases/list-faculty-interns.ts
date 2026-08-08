import { listFacultyInternRows } from "@/features/user-management/infra/repositories/user-management-repository";

export async function executeListFacultyInterns(facultyId: string, cohortId?: string | null) {
  const rows = await listFacultyInternRows(facultyId, cohortId);

  const deduped = new Map<string, (typeof rows)[number]>();
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
      // interno com mais de um vínculo: fica com a turma que termina por último
      ...((row.cohortEnd ?? "") > (existing.cohortEnd ?? "")
        ? { cohortName: row.cohortName, cohortStart: row.cohortStart, cohortEnd: row.cohortEnd }
        : {}),
    });
  }

  return [...deduped.values()];
}
