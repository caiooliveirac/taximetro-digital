import { operationalDateStr } from "@/lib/utils";
import { listRecentAlerts } from "@/features/alerts/infra/repositories/alerts-repository";

type Actor = {
  role: string;
  facultyId: string | null;
};

export async function executeListAlerts(actor: Actor) {
  const rows = await listRecentAlerts({
    today: operationalDateStr(),
    facultyId: actor.role === "LEADER" ? (actor.facultyId ?? undefined) : undefined,
  });

  return rows;
}
