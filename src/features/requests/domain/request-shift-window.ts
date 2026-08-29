import { hasShiftStarted, localDateStr } from "@/lib/utils";

// Plantão que uma solicitação toca. `date` nulo = a solicitação não aponta para
// esse plantão (troca aberta ainda sem contraparte, extra sem data etc.).
type ShiftRef = {
  date: string | null | undefined;
  period: string | null | undefined;
  shift?: string | null;
};

/**
 * O plantão já começou? O corte é o INÍCIO do turno (diurno 07:00, noturno
 * 19:00, EBMSP tarde 13:00). Serve para OFERTA — troca ou extra que ninguém
 * mais pode pegar porque o turno está em curso.
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

/** Datas de todos os plantões que a solicitação envolve — descarte, extra e os dois lados da troca. */
function shiftDates(r: RequestShiftRow): Array<string | null | undefined> {
  return [r.assignmentDate, r.targetAssignmentDate, r.extraDate];
}

/**
 * A solicitação é de hoje em diante? O corte é a DATA local (America/Sao_Paulo),
 * não a hora: plantão de hoje fica na tela o dia inteiro, mesmo com o turno já
 * em curso — o líder continua tendo o que decidir. Só cai fora quem tem data
 * anterior a hoje.
 *
 * Diferente de `shiftAlreadyStarted`, que corta no início do turno porque lá o
 * assunto é oferta, não decisão.
 *
 * Solicitação sem data alguma continua visível: não há passado para esconder.
 */
export function isTodayOrFutureRequest(r: RequestShiftRow, now: Date = new Date()): boolean {
  const today = localDateStr(now);
  return !shiftDates(r).some((date) => !!date && date < today);
}
