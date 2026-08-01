import {
  findFacultyInternIds,
  listRequestsRows,
} from "@/features/requests/infra/repositories/request-repository";
import { hasShiftStarted } from "@/lib/utils";

// Troca em aberto (ou proposta ainda não confirmada) cujo plantão já começou não
// serve mais para ninguém: some da lista em vez de ficar eternamente visível.
// O corte é o INÍCIO do turno, não o fim do dia — troca de diurno de hoje some
// às 07:00, não à meia-noite.
const SWAP_STALE_STATUSES = ["OPEN", "PENDING"];

type SwapShiftRef = {
  date: string | null;
  period: string | null;
  shift: string | null;
};

function shiftStarted(ref: SwapShiftRef, now: Date): boolean {
  if (!ref.date) return false;
  return hasShiftStarted(ref.date, ref.period === "NIGHT" ? "NIGHT" : "DAY", ref.shift, now);
}

export function isStaleSwap(r: {
  type: string;
  status: string;
  assignmentDate: string | null;
  assignmentPeriod?: string | null;
  assignmentShift?: string | null;
  targetAssignmentDate: string | null;
  targetAssignmentPeriod?: string | null;
  targetAssignmentShift?: string | null;
}, now: Date = new Date()) {
  if (r.type !== "SWAP" || !SWAP_STALE_STATUSES.includes(r.status)) return false;
  return (
    shiftStarted({ date: r.assignmentDate, period: r.assignmentPeriod ?? null, shift: r.assignmentShift ?? null }, now) ||
    shiftStarted({ date: r.targetAssignmentDate, period: r.targetAssignmentPeriod ?? null, shift: r.targetAssignmentShift ?? null }, now)
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

  const now = new Date();
  const rows = (await listRequestsRows()).filter((r) => !isStaleSwap(r, now));

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
