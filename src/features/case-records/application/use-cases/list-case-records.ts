import { listCaseRecords } from "@/features/case-records/infra/repositories/case-record-repository";

type Actor = {
  id: string;
  role: string;
};

export async function executeListCaseRecords(params: {
  actor: Actor;
  filters?: {
    internId?: string | null;
    assignmentId?: string | null;
  };
}) {
  const { actor, filters } = params;

  const rows = await listCaseRecords({
    internId: filters?.internId ?? undefined,
    assignmentId: filters?.assignmentId ?? undefined,
  });

  if (actor.role === "INTERN") {
    return rows.filter((record) => record.internId === actor.id);
  }

  return rows;
}
