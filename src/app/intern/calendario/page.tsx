"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { InternCalendar, type CalendarAssignment } from "@/components/intern-calendar";
import { InternDaySheet } from "@/components/intern-day-sheet";

type ApiAssignment = CalendarAssignment & { internId?: string };

const DONE_STATUSES = new Set(["CHECKED_OUT", "VALIDATED", "APPROVED"]);

export default function InternCalendarPage() {
  const [assignments, setAssignments] = useState<CalendarAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const [sheetItems, setSheetItems] = useState<CalendarAssignment[]>([]);

  useEffect(() => {
    fetch("/taximetro/api/assignments?selfOnly=true")
      .then((r) => r.json())
      .then((json) => {
        if (json?.success) {
          const active = (json.data as ApiAssignment[]).filter((a) => a.status !== "CANCELLED");
          setAssignments(active);
        } else {
          setError("Não foi possível carregar seus plantões.");
        }
      })
      .catch(() => setError("Não foi possível carregar seus plantões."))
      .finally(() => setLoading(false));
  }, []);

  const rotationBounds = useMemo(() => {
    if (assignments.length === 0) return null;
    const dates = [...assignments].map((a) => a.date).sort();
    return { first: dates[0], last: dates[dates.length - 1] };
  }, [assignments]);

  const progress = useMemo(() => {
    const done = assignments.filter((a) => DONE_STATUSES.has(a.status)).length;
    const absent = assignments.filter((a) => a.status === "ABSENT").length;
    return { total: assignments.length, done, absent };
  }, [assignments]);

  const handleDayPick = (dateStr: string, items: CalendarAssignment[]) => {
    setSheetDate(dateStr);
    setSheetItems(items);
  };
  const closeSheet = () => {
    setSheetDate(null);
    setSheetItems([]);
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <CalendarDays className="h-6 w-6 text-accent-500" strokeWidth={1.5} />
          Calendário
        </h1>
        {rotationBounds && (
          <p className="mt-1 text-sm text-slate-500">
            Rodízio {formatRange(rotationBounds.first, rotationBounds.last)}
          </p>
        )}
        {progress.total > 0 && (
          <p className="mt-1 text-sm text-slate-500">
            <b className="font-semibold tabular-nums text-slate-900">{progress.total}</b> plantão{progress.total > 1 ? "ões" : ""}
            {" · "}
            <b className="font-semibold tabular-nums text-emerald-600">{progress.done}</b> concluído{progress.done === 1 ? "" : "s"}
            {progress.absent > 0 && (
              <>
                {" · "}
                <b className="font-semibold tabular-nums text-red-600">{progress.absent}</b> ausente{progress.absent > 1 ? "s" : ""}
              </>
            )}
          </p>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          Carregando...
        </div>
      ) : error ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : assignments.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          Nenhum plantão escalado.
        </div>
      ) : (
        <InternCalendar assignments={assignments} onDayPick={handleDayPick} />
      )}

      <InternDaySheet
        open={!!sheetDate}
        dateStr={sheetDate}
        assignments={sheetItems}
        onClose={closeSheet}
      />
    </div>
  );
}

function formatRange(first: string, last: string): string {
  const f = new Date(`${first}T12:00:00`);
  const l = new Date(`${last}T12:00:00`);
  const sameYear = f.getFullYear() === l.getFullYear();
  const fFmt = sameYear ? "d MMM" : "d MMM yyyy";
  return `${format(f, fFmt, { locale: ptBR })} – ${format(l, "d MMM yyyy", { locale: ptBR })}`;
}
