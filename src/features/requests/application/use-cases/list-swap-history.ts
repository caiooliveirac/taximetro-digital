import {
  findFacultyInternIds,
  listCompletedSwapRows,
} from "@/features/requests/infra/repositories/request-repository";

type SwapHistoryActor = {
  id: string;
  role: string;
  facultyId: string | null;
};

export async function executeListSwapHistory(params: {
  actor: SwapHistoryActor;
  internId?: string | null;
  selfOnly?: boolean;
}) {
  const { actor, internId, selfOnly = false } = params;
  const rows = await listCompletedSwapRows();

  let filtered = rows;

  if (internId && ["COORDINATOR", "LEADER"].includes(actor.role)) {
    filtered = rows.filter((r) => r.requesterId === internId || r.targetInternId === internId);
  } else if (actor.role === "INTERN" || (actor.role === "LEADER" && selfOnly)) {
    filtered = rows.filter((r) => r.requesterId === actor.id || r.targetInternId === actor.id);
  } else if (actor.role === "LEADER" && actor.facultyId) {
    const facultyInternIds = await findFacultyInternIds(actor.facultyId);
    filtered = rows.filter((r) =>
      facultyInternIds.has(r.requesterId) ||
      (r.targetInternId ? facultyInternIds.has(r.targetInternId) : false),
    );
  }

  const data = filtered.map((r) => ({
    id: r.id,
    completedAt: r.reviewedAt ?? r.createdAt,
    requester: {
      id: r.requesterId,
      name: r.requesterName,
      gave: r.origBaseCode ? {
        baseCode: r.origBaseCode,
        baseName: r.origBaseName,
        date: r.origDate,
        period: r.origPeriod,
        shift: r.origShift,
        assignmentStatus: r.origStatus,
      } : null,
      received: r.targetBaseCode ? {
        baseCode: r.targetBaseCode,
        baseName: r.targetBaseName,
        date: r.targetDate,
        period: r.targetPeriod,
        shift: r.targetShift,
        assignmentStatus: r.targetStatus,
      } : null,
    },
    target: {
      id: r.targetInternId,
      name: r.targetInternName,
      gave: r.targetBaseCode ? {
        baseCode: r.targetBaseCode,
        baseName: r.targetBaseName,
        date: r.targetDate,
        period: r.targetPeriod,
        shift: r.targetShift,
        assignmentStatus: r.targetStatus,
      } : null,
      received: r.origBaseCode ? {
        baseCode: r.origBaseCode,
        baseName: r.origBaseName,
        date: r.origDate,
        period: r.origPeriod,
        shift: r.origShift,
        assignmentStatus: r.origStatus,
      } : null,
    },
  }));

  return data;
}
