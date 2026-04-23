import { addDaysToDateStr, startOfWeekDateStr } from "@/lib/utils";

export function computeCruFixedWeeksWindow(params: {
  today: string;
  weeks: number;
}) {
  const weekStart = startOfWeekDateStr(params.today);
  const validUntil = addDaysToDateStr(weekStart, params.weeks * 7 - 1);

  return {
    startDate: params.today,
    weekStart,
    validUntil,
  };
}
