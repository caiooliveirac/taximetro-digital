import {
  findFacultyInternIds,
  listRequestsRows,
  type FiltroDePedidos,
} from "@/features/requests/infra/repositories/request-repository";
import { addDaysToDateStr, localDateStr } from "@/lib/utils";
import { shiftAlreadyStarted } from "@/features/requests/domain/request-shift-window";
import { podeTrocarEntreFaculdades } from "@/shared/domain/policies/cross-faculty-swap-policy";

// Troca em aberto (ou proposta ainda não confirmada) cujo plantão já começou não
// serve mais para ninguém: some da lista em vez de ficar eternamente visível.
// O corte é o INÍCIO do turno, não o fim do dia — troca de diurno de hoje some
// às 07:00, não à meia-noite.
const SWAP_STALE_STATUSES = ["OPEN", "PENDING"];

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
    shiftAlreadyStarted({ date: r.assignmentDate, period: r.assignmentPeriod, shift: r.assignmentShift }, now) ||
    shiftAlreadyStarted({ date: r.targetAssignmentDate, period: r.targetAssignmentPeriod, shift: r.targetAssignmentShift }, now)
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
  const trocasAbertas = scope === "open-swaps" && (actor.role === "INTERN" || actor.role === "LEADER") && Boolean(actor.facultyId);
  const daFaculdade = !trocasAbertas && !selfOnly && actor.role === "LEADER" && actor.facultyId ? await findFacultyInternIds(actor.facultyId) : null;

  // O mesmo recorte de baixo, já no SQL: a tabela inteira só para a coordenação.
  let filtro: FiltroDePedidos = {};
  if (trocasAbertas) filtro = { trocasAbertasDesde: addDaysToDateStr(localDateStr(now), -1) };
  else if (actor.role === "COORDINATOR" && internId) filtro = { solicitantes: [internId] };
  else if ((selfOnly && (actor.role === "INTERN" || actor.role === "LEADER")) || actor.role === "INTERN") filtro = { pessoa: actor.id };
  else if (daFaculdade) filtro = { solicitantes: [...daFaculdade] };

  const rows = (await listRequestsRows(filtro)).filter((r) => !isStaleSwap(r, now));

  // Oferta da própria faculdade, de qualquer tipo; de outra faculdade, só USA
  // (ver cross-faculty-swap-policy.ts).
  if (trocasAbertas && actor.facultyId) {
    const facultyInternIds = await findFacultyInternIds(actor.facultyId);
    const filtered = rows.filter((r) =>
      r.type === "SWAP" &&
      r.status === "OPEN" &&
      (facultyInternIds.has(r.requesterId) || podeTrocarEntreFaculdades(r.baseType)) &&
      r.requesterId !== actor.id,
    );
    return filtered;
  }

  let filtered = rows;
  if (selfOnly && (actor.role === "INTERN" || actor.role === "LEADER")) {
    filtered = rows.filter((r) => r.requesterId === actor.id || r.targetInternId === actor.id);
  } else if (actor.role === "INTERN") {
    filtered = rows.filter((r) => r.requesterId === actor.id || r.targetInternId === actor.id);
  } else if (daFaculdade) {
    // Pedido de vaga livre acima da meta é decisão da coordenação, não do líder.
    filtered = rows.filter((r) => daFaculdade.has(r.requesterId) && r.type !== "FREE_SLOT");
  }

  if (actor.role === "COORDINATOR" && internId) {
    filtered = rows.filter((r) => r.requesterId === internId);
  }

  return filtered;
}
