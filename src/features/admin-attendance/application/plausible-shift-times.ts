/**
 * Gera timestamps "plausíveis" para um plantão quando o coordenador
 * confirma presença/checkout manualmente — para que o relatório enviado
 * ao diretor mostre horários coerentes com o turno em vez do momento real
 * (que pode ser dias depois) em que a ação manual foi executada.
 *
 * Janelas (horário local — America/Bahia, UTC-3 sem horário de verão):
 *   - DAY   → check-in 06:55–07:10, checkout 18:55–19:10 (mesma data)
 *   - NIGHT → check-in 18:55–19:10 (data), checkout 06:55–07:10 (data + 1)
 *
 * Audit log preserva o registro real (actor + timestamp do clique).
 */

export type ShiftPeriod = "DAY" | "NIGHT";

export interface PlausibleShiftTimes {
  checkinAt: Date;
  checkoutAt: Date;
}

const BAHIA_UTC_OFFSET_HOURS = 3; // UTC-3, fixo (sem DST)

function parseLocalDate(dateStr: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`assignment date inválido: ${dateStr}`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * Converte uma data civil (Bahia) + hora local em um Date UTC.
 * Lida com transição de meia-noite (ex.: 06:00 Bahia do dia seguinte
 * = 09:00 UTC do dia seguinte) usando Date.UTC, que normaliza overflow.
 */
function bahiaLocalToUtc(
  year: number,
  month: number,
  day: number,
  hourLocal: number,
  minute: number,
  second: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hourLocal + BAHIA_UTC_OFFSET_HOURS, minute, second));
}

interface Window {
  startHour: number; // hora local Bahia
  startMinute: number;
  endHour: number;
  endMinute: number;
  /** offset de dias relativo à data do assignment */
  dayOffset: number;
}

const CHECKIN_DAY: Window = { startHour: 6, startMinute: 55, endHour: 7, endMinute: 10, dayOffset: 0 };
const CHECKOUT_DAY: Window = { startHour: 18, startMinute: 55, endHour: 19, endMinute: 10, dayOffset: 0 };
const CHECKIN_NIGHT: Window = { startHour: 18, startMinute: 55, endHour: 19, endMinute: 10, dayOffset: 0 };
const CHECKOUT_NIGHT: Window = { startHour: 6, startMinute: 55, endHour: 7, endMinute: 10, dayOffset: 1 };

function pickInWindow(
  base: { year: number; month: number; day: number },
  win: Window,
  rng: () => number,
): Date {
  const startTotal = win.startHour * 60 + win.startMinute;
  const endTotal = win.endHour * 60 + win.endMinute;
  // inteiro em [startTotal, endTotal] (inclusivo)
  const minuteTotal = startTotal + Math.floor(rng() * (endTotal - startTotal + 1));
  const hour = Math.floor(minuteTotal / 60);
  const minute = minuteTotal % 60;
  const second = Math.floor(rng() * 60);
  return bahiaLocalToUtc(base.year, base.month, base.day + win.dayOffset, hour, minute, second);
}

export function pickPlausibleShiftTimes(params: {
  /** assignment.date no formato YYYY-MM-DD */
  date: string;
  period: ShiftPeriod;
  /** injetável para testes; default Math.random */
  rng?: () => number;
}): PlausibleShiftTimes {
  const rng = params.rng ?? Math.random;
  const base = parseLocalDate(params.date);
  const checkinWindow = params.period === "DAY" ? CHECKIN_DAY : CHECKIN_NIGHT;
  const checkoutWindow = params.period === "DAY" ? CHECKOUT_DAY : CHECKOUT_NIGHT;
  return {
    checkinAt: pickInWindow(base, checkinWindow, rng),
    checkoutAt: pickInWindow(base, checkoutWindow, rng),
  };
}
