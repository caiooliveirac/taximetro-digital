import { isWithinShiftCheckoutWindow, localDateStr } from "@/lib/utils";

// Texto que o sweep grava no check-in ao transformar plantão sem checkout em
// falta. É também a marca que separa "fez check-in e ninguém fechou" de "não
// veio": a falta lançada à mão apaga totpValidatedAt e grava outra nota.
export const AUTO_ABSENCE_CHECKOUT_NOTE = "Falta automática: plantão encerrado sem checkout";

export type PendingAttendanceRow = {
  status: string;
  isExtraShift: boolean;
  checkinStatus: string | null;
  totpValidatedAt: Date | string | null;
  checkoutAt: Date | string | null;
  checkoutNotes: string | null;
};

/** Check-in validado que o sweep rejeitou porque ninguém fez o checkout. */
export function isAutoAbsenceAfterCheckin(row: Omit<PendingAttendanceRow, "isExtraShift">): boolean {
  return row.status === "ABSENT"
    && row.checkinStatus === "REJECTED"
    && row.totpValidatedAt != null
    && row.checkoutAt == null
    && row.checkoutNotes === AUTO_ABSENCE_CHECKOUT_NOTE;
}

/**
 * O que falta neste plantão para o preceptor resolver:
 * - CHECKOUT: entrou e ninguém fechou (em aberto ou já virado falta pelo sweep);
 * - CHECKIN: não há check-in validado;
 * - null: resolvido (checkout feito, abonado, cancelado) — não aparece.
 */
export function classifyPendingAttendance(row: PendingAttendanceRow): "CHECKOUT" | "CHECKIN" | null {
  if (row.status === "CHECKED_OUT" || row.status === "CANCELLED" || row.status === "EXCUSED") return null;
  if (row.status === "CHECKED_IN" || isAutoAbsentOrOpen(row)) return "CHECKOUT";
  // Extra nunca reivindicado fica SCHEDULED para sempre (o sweep ignora extras).
  if (row.isExtraShift) return null;
  if (row.status === "SCHEDULED" || row.status === "CONFIRMED" || row.status === "ABSENT") return "CHECKIN";
  return null;
}

function isAutoAbsentOrOpen(row: PendingAttendanceRow): boolean {
  if (row.checkinStatus === "VALIDATED") return true;
  return isAutoAbsenceAfterCheckin(row);
}

/**
 * Checkout dentro da janela do turno grava o instante real. Fora dela (dias
 * depois), grava um horário plausível de fim de turno — o relatório não deve
 * mostrar o momento em que o preceptor lembrou.
 */
export function isRetroactiveCheckout(
  assignment: { date: string; period: "DAY" | "NIGHT"; shift: string | null },
  now: Date = new Date(),
): boolean {
  if (assignment.date >= localDateStr(now)) return false;
  return !isWithinShiftCheckoutWindow(assignment.date, assignment.period, assignment.shift, now);
}
