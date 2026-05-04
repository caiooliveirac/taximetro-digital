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

  // Avaliação do preceptor (preceptorObservations + NPS dentro de checkoutNotes)
  // só pode ser vista por COORDINATOR. Líderes recebem os demais detalhes do
  // plantão, mas nunca a opinião/avaliação que o preceptor fez do interno.
  if (actor.role !== "COORDINATOR") {
    return rows.map((r) => ({
      ...r,
      preceptorObservations: null,
      checkoutNotes: stripNpsFromNotes(r.checkoutNotes),
    }));
  }
  return rows;
}

function stripNpsFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const cleaned = notes
    .split("|")
    .map((seg) => seg.trim())
    .filter((seg) => seg && !seg.startsWith("NPS"))
    .join(" | ");
  return cleaned || null;
}
