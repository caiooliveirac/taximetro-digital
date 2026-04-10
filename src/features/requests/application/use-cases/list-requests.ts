import {
  findFacultyInternIds,
  listRequestsRows,
} from "@/features/requests/infra/repositories/request-repository";

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

  const rows = await listRequestsRows();

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
