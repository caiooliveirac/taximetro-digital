import { hasShiftStarted } from "@/lib/utils";

// Plantão que uma solicitação toca. `date` nulo = a solicitação não aponta para
// esse plantão (troca aberta ainda sem contraparte, extra sem data etc.).
type ShiftRef = {
  date: string | null | undefined;
  period: string | null | undefined;
  shift?: string | null;
};

/**
 * O plantão já começou? O corte é o INÍCIO do turno (diurno 07:00, noturno
 * 19:00, EBMSP tarde 13:00), não a virada do dia — plantão diurno de hoje deixa
 * de ser futuro às 07:00.
 */
export function shiftAlreadyStarted(ref: ShiftRef, now: Date = new Date()): boolean {
  if (!ref.date) return false;
  return hasShiftStarted(ref.date, ref.period === "NIGHT" ? "NIGHT" : "DAY", ref.shift ?? null, now);
}

export type RequestShiftRow = {
  type: string;
  assignmentDate?: string | null;
  assignmentPeriod?: string | null;
  assignmentShift?: string | null;
  targetAssignmentDate?: string | null;
  targetAssignmentPeriod?: string | null;
  targetAssignmentShift?: string | null;
  extraDate?: string | null;
  extraPeriod?: string | null;
};

/** Todos os plantões que a solicitação envolve — descarte, extra e os dois lados da troca. */
function shiftRefs(r: RequestShiftRow): ShiftRef[] {
  return [
    { date: r.assignmentDate, period: r.assignmentPeriod, shift: r.assignmentShift },
    { date: r.targetAssignmentDate, period: r.targetAssignmentPeriod, shift: r.targetAssignmentShift },
    { date: r.extraDate, period: r.extraPeriod },
  ];
}

/**
 * A solicitação ainda trata de plantão futuro? Se qualquer plantão envolvido já
 * começou, aprovar ou recusar não muda mais nada — é decisão sobre passado.
 * Solicitação sem data alguma continua futura: não há passado para esconder.
 */
export function isFutureShiftRequest(r: RequestShiftRow, now: Date = new Date()): boolean {
  return !shiftRefs(r).some((ref) => shiftAlreadyStarted(ref, now));
}
