import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const BRAZIL_TIME_ZONE = "America/Sao_Paulo";
const OPERATIONAL_DAY_START_HOUR = 6;
const OPERATIONAL_NIGHT_START_HOUR = 18;
const SHIFT_CHECKOUT_GRACE_HOURS = 6;

export type ShiftPeriod = "DAY" | "NIGHT";

type TimeZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function getTimeZoneParts(date: Date = new Date()): TimeZoneParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";

  return {
    year: Number(lookup("year")),
    month: Number(lookup("month")),
    day: Number(lookup("day")),
    hour: Number(lookup("hour")),
    minute: Number(lookup("minute")),
  };
}

function ymdFromUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function utcDateFromDateStr(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

type LocalDateTimePoint = {
  dateStr: string;
  hour: number;
  minute: number;
};

function compareLocalDateTime(a: LocalDateTimePoint, b: LocalDateTimePoint): number {
  if (a.dateStr < b.dateStr) return -1;
  if (a.dateStr > b.dateStr) return 1;
  if (a.hour < b.hour) return -1;
  if (a.hour > b.hour) return 1;
  if (a.minute < b.minute) return -1;
  if (a.minute > b.minute) return 1;
  return 0;
}

function currentLocalPoint(date: Date = new Date()): LocalDateTimePoint {
  const parts = getTimeZoneParts(date);
  return {
    dateStr: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    hour: parts.hour,
    minute: parts.minute,
  };
}

function shiftStartPoint(dateStr: string, period: ShiftPeriod): LocalDateTimePoint {
  return {
    dateStr,
    hour: period === "DAY" ? OPERATIONAL_DAY_START_HOUR : OPERATIONAL_NIGHT_START_HOUR,
    minute: 0,
  };
}

function shiftCheckoutDeadlinePoint(dateStr: string, period: ShiftPeriod): LocalDateTimePoint {
  if (period === "DAY") {
    return {
      dateStr: addDaysToDateStr(dateStr, 1),
      hour: 0,
      minute: 0,
    };
  }

  return {
    dateStr: addDaysToDateStr(dateStr, 1),
    hour: OPERATIONAL_DAY_START_HOUR + SHIFT_CHECKOUT_GRACE_HOURS,
    minute: 0,
  };
}

function shiftCheckoutStartPoint(dateStr: string, period: ShiftPeriod): LocalDateTimePoint {
  if (period === "DAY") {
    return {
      dateStr,
      hour: OPERATIONAL_NIGHT_START_HOUR,
      minute: 0,
    };
  }

  return {
    dateStr: addDaysToDateStr(dateStr, 1),
    hour: OPERATIONAL_DAY_START_HOUR,
    minute: 0,
  };
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const date = utcDateFromDateStr(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return ymdFromUtcDate(date);
}

export function startOfWeekDateStr(dateStr: string): string {
  const date = utcDateFromDateStr(dateStr);
  const dayOfWeek = date.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return addDaysToDateStr(dateStr, diffToMonday);
}

export function weeksBetweenDateStr(from: string, to: string): number {
  const fromDate = utcDateFromDateStr(from);
  const toDate = utcDateFromDateStr(to);
  return Math.floor((toDate.getTime() - fromDate.getTime()) / (7 * 86_400_000));
}

export function getBrazilNowParts(date: Date = new Date()): TimeZoneParts {
  return getTimeZoneParts(date);
}

export function operationalDateStr(date: Date = new Date()): string {
  const parts = getTimeZoneParts(date);
  const currentDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (parts.hour < OPERATIONAL_DAY_START_HOUR) {
    currentDate.setUTCDate(currentDate.getUTCDate() - 1);
  }
  return ymdFromUtcDate(currentDate);
}

export function isOperationalDaytime(date: Date = new Date()): boolean {
  const { hour } = getTimeZoneParts(date);
  return hour >= OPERATIONAL_DAY_START_HOUR && hour < OPERATIONAL_NIGHT_START_HOUR;
}

export function operationalPeriod(date: Date = new Date()): ShiftPeriod {
  return isOperationalDaytime(date) ? "DAY" : "NIGHT";
}

export function isCurrentOperationalAssignment(
  assignmentDate: string,
  period: ShiftPeriod,
  date: Date = new Date(),
): boolean {
  return assignmentDate === operationalDateStr(date) && period === operationalPeriod(date);
}

export function isWithinAttendanceWindow(
  assignmentDate: string,
  period: ShiftPeriod,
  date: Date = new Date(),
): boolean {
  const now = currentLocalPoint(date);
  const start = shiftStartPoint(assignmentDate, period);
  const deadline = shiftCheckoutDeadlinePoint(assignmentDate, period);

  return compareLocalDateTime(now, start) >= 0 && compareLocalDateTime(now, deadline) <= 0;
}

export function isWithinInternCheckoutWindow(
  assignmentDate: string,
  period: ShiftPeriod,
  date: Date = new Date(),
): boolean {
  const now = currentLocalPoint(date);
  const start = shiftCheckoutStartPoint(assignmentDate, period);
  const deadline = shiftCheckoutDeadlinePoint(assignmentDate, period);

  return compareLocalDateTime(now, start) >= 0 && compareLocalDateTime(now, deadline) <= 0;
}

export function isWithinAdminAttendanceWindow(
  assignmentDate: string,
  date: Date = new Date(),
): boolean {
  const currentDate = localDateStr(date);
  const previousDate = addDaysToDateStr(currentDate, -1);
  return assignmentDate === currentDate || assignmentDate === previousDate;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a Date as YYYY-MM-DD in local timezone (avoids UTC shift from toISOString) */
export function localDateStr(d: Date = new Date()): string {
  const { year, month, day } = getTimeZoneParts(d);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeDateValue(value: Date | string): Date {
  if (value instanceof Date) return value;

  const normalizedValue = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(normalizedValue)) {
    return new Date(normalizedValue.replace(" ", "T") + "Z");
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(normalizedValue)) {
    return new Date(normalizedValue + "Z");
  }

  return new Date(normalizedValue);
}

export function formatBrazilTime(value: Date | string) {
  return normalizeDateValue(value).toLocaleTimeString("pt-BR", {
    timeZone: BRAZIL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}
