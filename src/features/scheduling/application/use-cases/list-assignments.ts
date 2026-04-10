import { listAssignmentsWithRelations } from "@/features/scheduling/infra/repositories/assignment-query-repository";

type Actor = {
  id: string;
  role: string;
  facultyId: string | null;
};

export async function executeListAssignments(params: {
  actor: Actor;
  filters: {
    from?: string | null;
    to?: string | null;
    facultyId?: string | null;
    baseId?: string | null;
    period?: string | null;
    internId?: string | null;
    selfOnly?: boolean;
  };
}) {
  const { actor, filters } = params;

  const normalized: Parameters<typeof listAssignmentsWithRelations>[0] = {
    dateFrom: filters.from ?? undefined,
    dateTo: filters.to ?? undefined,
    facultyId: undefined as string | undefined,
    baseId: undefined as string | undefined,
    period: filters.period === "DAY" || filters.period === "NIGHT" ? filters.period : undefined,
    internId: undefined as string | undefined,
    selfOnlyUserId: filters.selfOnly ? actor.id : undefined,
  };

  if (actor.role === "LEADER" && actor.facultyId) {
    normalized.facultyId = actor.facultyId;
  } else if (filters.facultyId) {
    normalized.facultyId = filters.facultyId;
  }

  if (actor.role === "INTERN") {
    normalized.internId = actor.id;
  } else if (filters.internId && (actor.role === "COORDINATOR" || actor.role === "LEADER")) {
    normalized.internId = filters.internId;
  }

  if (actor.role === "PRECEPTOR") {
    if (filters.baseId) normalized.baseId = filters.baseId;
  } else if (filters.baseId) {
    normalized.baseId = filters.baseId;
  }

  const rows = await listAssignmentsWithRelations(normalized);
  return rows;
}
