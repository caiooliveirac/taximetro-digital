import {
  findFacultyInternIds,
  listRequestsRows,
} from "@/features/requests/infra/repositories/request-repository";
import { localDateStr } from "@/lib/utils";

// Troca em aberto (ou proposta ainda não confirmada) cujo plantão já passou não
// serve mais para ninguém: some da lista em vez de ficar eternamente visível.
const SWAP_STALE_STATUSES = ["OPEN", "PENDING"];

export function isStaleSwap(r: { type: string; status: string; assignmentDate: string | null; targetAssignmentDate: string | null }, today: string) {
  if (r.type !== "SWAP" || !SWAP_STALE_STATUSES.includes(r.status)) return false;
  return (
    (!!r.assignmentDate && r.assignmentDate < today) ||
    (!!r.targetAssignmentDate && r.targetAssignmentDate < today)
  );
}

type ListRequestsActor = {
  id: string;
  role: string;
  facultyId: string | null;
};

export async function executeListRequests(params: {
  actor: ListRequestsActor;
  scope?: string | null;
  selfOnly?: boolean;
  internId?: string | null;
}) {
  const { actor, scope, selfOnly = false, internId } = params;

  const today = localDateStr();
  const rows = (await listRequestsRows()).filter((r) => !isStaleSwap(r, today));

  if (scope === "open-swaps" && (actor.role === "INTERN" || actor.role === "LEADER") && actor.facultyId) {
    const facultyInternIds = await findFacultyInternIds(actor.facultyId);
    const filtered = rows.filter((r) =>
      r.type === "SWAP" &&
      r.status === "OPEN" &&
      facultyInternIds.has(r.requesterId) &&
      r.requesterId !== actor.id,
    );
    return filtered;
  }

  let filtered = rows;
  if (selfOnly && (actor.role === "INTERN" || actor.role === "LEADER")) {
    filtered = rows.filter((r) => r.requesterId === actor.id || r.targetInternId === actor.id);
  } else if (actor.role === "INTERN") {
    filtered = rows.filter((r) => r.requesterId === actor.id || r.targetInternId === actor.id);
  } else if (actor.role === "LEADER" && actor.facultyId) {
    const facultyInternIds = await findFacultyInternIds(actor.facultyId);
    filtered = rows.filter((r) => facultyInternIds.has(r.requesterId));
  }

  if (actor.role === "COORDINATOR" && internId) {
    filtered = rows.filter((r) => r.requesterId === internId);
  }

  return filtered;
}
