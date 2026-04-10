import { listCaseRecords } from "@/features/case-records/infra/repositories/case-record-repository";

type Actor = {
  id: string;
  role: string;
};

export async function executeListCaseRecords(actor: Actor) {
  const rows = await listCaseRecords();

  if (actor.role === "INTERN") {
    return rows.filter((record) => record.internId === actor.id);
  }

  return rows;
}
