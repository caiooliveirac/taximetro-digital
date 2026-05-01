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

type DayStatus = "done" | "active" | "absent" | "pending";

function getDayStatus(items: CalendarAssignment[]): DayStatus {
  if (items.length === 0) return "pending";
  if (items.some((a) => a.status === "ABSENT")) return "absent";
  if (items.some((a) => a.status === "CHECKED_IN")) return "active";
  if (items.every((a) => a.status === "CHECKED_OUT" || a.status === "VALIDATED" || a.status === "APPROVED")) return "done";
  return "pending";
}

const STATUS_DOT: Record<DayStatus, string | null> = {
  done: "bg-emerald-400",
  active: "bg-amber-400 animate-pulse",
  absent: "bg-red-400",
  pending: null,
};

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
      const dayStatus = hasAny ? getDayStatus(items) : "pending";
      const statusDot = STATUS_DOT[dayStatus];

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
            "group relative flex h-[76px] w-full flex-col items-stretch gap-0.5 rounded-lg border px-1.5 pb-1.5 pt-1.5 text-left outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-accent-500/50",
            modifiers.outside
              ? "border-transparent bg-transparent opacity-20"
              : "border-slate-200/60 bg-white",
            modifiers.today && !modifiers.outside && "border-accent-500/70 shadow-[0_0_0_1px_rgba(249,115,22,0.15)]",
            hasAny && !modifiers.outside && "cursor-pointer hover:border-slate-300 hover:bg-slate-50/80 hover:shadow-sm active:scale-[0.97]",
            !hasAny && "cursor-default",
          )}
        >
          {/* Day number with today pill */}
          <div className="flex items-start justify-between">
            <span
              className={cn(
                "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full text-[10px] font-semibold leading-none",
                modifiers.today && !modifiers.outside
                  ? "bg-accent-500 px-1 text-white"
                  : "text-slate-600",
              )}
            >
              {day.date.getDate()}
            </span>
            {/* Status micro-dot */}
            {hasAny && !modifiers.outside && statusDot && (
              <span className={cn("mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full", statusDot)} />
            )}
          </div>

          {/* Assignment badges */}
          {hasAny && (
            <div className="mt-auto space-y-0.5">
              {visible.map((a) => {
                const bs = getBaseStyle(a.baseType ?? undefined);
                const Icon = a.period === "DAY" ? Sun : Moon;
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "flex h-[15px] items-center gap-0.5 rounded px-1",
                      bs.bg,
                      bs.text,
                    )}
                  >
                    <Icon className="h-2.5 w-2.5 shrink-0 opacity-80" strokeWidth={2.5} />
                    <span className="truncate text-[9px] font-bold leading-none tracking-tight">{a.baseCode}</span>
                  </div>
                );
              })}
              {extra > 0 && (
                <span className="block text-center text-[8px] font-semibold leading-none text-slate-400">
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
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      {/* Calendar header with subtle gradient */}
      <div className="flex items-center justify-between bg-gradient-to-b from-slate-50 to-white px-3 py-3 border-b border-slate-100">
        <button
          type="button"
          onClick={() => canPrev && setMonth(addMonths(month, -1))}
          disabled={!canPrev}
          aria-label="Mês anterior"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-25"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
        </button>
        <p className="text-sm font-semibold capitalize tracking-wide text-slate-800">
          {format(month, "MMMM 'de' yyyy", { locale: ptBR })}
        </p>
        <button
          type="button"
          onClick={() => canNext && setMonth(addMonths(month, 1))}
          disabled={!canNext}
          aria-label="Próximo mês"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-25"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>

      <div className="p-3">
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
            weekdays: "grid grid-cols-7 gap-1 mb-1.5",
            weekday: "py-1 text-center text-[9px] font-bold uppercase tracking-widest text-slate-400",
            weeks: "space-y-1",
            week: "grid grid-cols-7 gap-1",
            day: "p-0",
          }}
          components={{ DayButton: DayCell }}
        />
      </div>
    </div>
  );
}
