"use client";

import { DayPicker, type DayButtonProps } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Moon, Sun } from "lucide-react";
import { getBaseStyle } from "@/lib/base-colors";
import { cn, localDateStr } from "@/lib/utils";

export type CalendarAssignment = {
  id: string;
  baseCode: string;
  baseName: string;
  baseType?: string | null;
  baseLatitude: number;
  baseLongitude: number;
  date: string;
  period: "DAY" | "NIGHT";
  shift?: string | null;
  status: string;
};

type Props = {
  assignments: CalendarAssignment[];
  onDayPick: (dateStr: string, dayAssignments: CalendarAssignment[]) => void;
};

const SHIFT_ORDER: Record<string, number> = { MORNING: 0, AFTERNOON: 1, NIGHT: 2 };

function shiftRank(shift: string | null | undefined): number {
  return shift ? SHIFT_ORDER[shift] ?? 2 : 2;
}

export function InternCalendar({ assignments, onDayPick }: Props) {
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarAssignment[]>();
    for (const a of assignments) {
      const arr = map.get(a.date) ?? [];
      arr.push(a);
      map.set(a.date, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.period !== b.period) return a.period === "DAY" ? -1 : 1;
        const byShift = shiftRank(a.shift) - shiftRank(b.shift);
        if (byShift !== 0) return byShift;
        return a.baseCode.localeCompare(b.baseCode, "pt-BR");
      });
    }
    return map;
  }, [assignments]);

  const { startMonth, endMonth, initialMonth } = useMemo(() => {
    const today = new Date();
    if (assignments.length === 0) {
      return {
        startMonth: startOfMonth(addMonths(today, -1)),
        endMonth: endOfMonth(addMonths(today, 1)),
        initialMonth: startOfMonth(today),
      };
    }
    const times = assignments.map((a) => new Date(`${a.date}T12:00:00`).getTime());
    const min = new Date(Math.min(...times));
    const max = new Date(Math.max(...times));
    const s = startOfMonth(min);
    const e = endOfMonth(max);
    const todayInRange = today.getTime() >= s.getTime() && today.getTime() <= e.getTime();
    return {
      startMonth: s,
      endMonth: e,
      initialMonth: startOfMonth(todayInRange ? today : min),
    };
  }, [assignments]);

  const [month, setMonth] = useState<Date>(initialMonth);

  const canPrev = addMonths(month, -1).getTime() >= startMonth.getTime();
  const canNext = addMonths(month, 1).getTime() <= endMonth.getTime();

  const handleDayClick = useCallback(
    (date: Date) => {
      const key = localDateStr(date);
      const items = byDate.get(key);
      if (items && items.length > 0) onDayPick(key, items);
    },
    [byDate, onDayPick],
  );

  const DayCell = useCallback(
    ({ day, modifiers, className: _cn, ...rest }: DayButtonProps) => {
      const key = localDateStr(day.date);
      const items = byDate.get(key) ?? [];
      const hasAny = items.length > 0;
      const visible = items.slice(0, 2);
      const extra = items.length - visible.length;

      return (
        <button
          {...rest}
          type="button"
          disabled={!hasAny || modifiers.disabled}
          aria-label={
            hasAny
              ? `Dia ${day.date.getDate()} — ${items.length} plantão${items.length > 1 ? "ões" : ""}`
              : `Dia ${day.date.getDate()}`
          }
          className={cn(
            "flex h-16 w-full flex-col items-stretch gap-0.5 rounded-md border px-1 pb-1 pt-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-500/50",
            modifiers.outside
              ? "border-transparent bg-transparent opacity-30"
              : "border-slate-200/70 bg-white",
            modifiers.today && !modifiers.outside && "border-accent-500",
            hasAny && !modifiers.outside && "hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98]",
            !hasAny && "cursor-default",
          )}
        >
          <span
            className={cn(
              "text-[10px] font-semibold leading-none",
              modifiers.today ? "text-accent-600" : "text-slate-600",
            )}
          >
            {day.date.getDate()}
          </span>
          {hasAny && (
            <div className="mt-auto space-y-0.5">
              {visible.map((a) => {
                const bs = getBaseStyle(a.baseType ?? undefined);
                const Icon = a.period === "DAY" ? Sun : Moon;
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "flex h-3.5 items-center justify-center gap-0.5 rounded-sm px-0.5",
                      bs.bg,
                      bs.text,
                    )}
                  >
                    <Icon className="h-2.5 w-2.5 shrink-0" strokeWidth={2} />
                    <span className="truncate text-[8px] font-bold leading-none">{a.baseCode}</span>
                  </div>
                );
              })}
              {extra > 0 && (
                <span className="block text-center text-[8px] font-semibold leading-none text-slate-500">
                  +{extra}
                </span>
              )}
            </div>
          )}
        </button>
      );
    },
    [byDate],
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => canPrev && setMonth(addMonths(month, -1))}
          disabled={!canPrev}
          aria-label="Mês anterior"
          className="rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2} />
        </button>
        <p className="text-sm font-semibold capitalize text-slate-900">
          {format(month, "MMMM 'de' yyyy", { locale: ptBR })}
        </p>
        <button
          type="button"
          onClick={() => canNext && setMonth(addMonths(month, 1))}
          disabled={!canNext}
          aria-label="Próximo mês"
          className="rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      <DayPicker
        month={month}
        onMonthChange={setMonth}
        onDayClick={handleDayClick}
        locale={ptBR}
        weekStartsOn={1}
        showOutsideDays
        fixedWeeks
        startMonth={startMonth}
        endMonth={endMonth}
        hideNavigation
        classNames={{
          months: "",
          month: "space-y-1",
          month_caption: "hidden",
          weekdays: "grid grid-cols-7 gap-1 mb-1",
          weekday: "py-1 text-center text-[10px] font-semibold uppercase text-slate-400",
          weeks: "space-y-1",
          week: "grid grid-cols-7 gap-1",
          day: "p-0",
        }}
        components={{ DayButton: DayCell }}
      />
    </div>
  );
}
