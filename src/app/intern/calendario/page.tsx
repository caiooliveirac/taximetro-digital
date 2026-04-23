"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Moon, Sun } from "lucide-react";
import { InternCalendar, type CalendarAssignment } from "@/components/intern-calendar";
import { InternDaySheet } from "@/components/intern-day-sheet";
import { getBaseStyle } from "@/lib/base-colors";
import { cn } from "@/lib/utils";

type ApiAssignment = CalendarAssignment & { internId?: string };

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

  const basesInUse = useMemo(() => {
    const seen = new Map<string, { type?: string | null; code: string; name: string }>();
    for (const a of assignments) {
      if (!seen.has(a.baseCode)) {
        seen.set(a.baseCode, { type: a.baseType, code: a.baseCode, name: a.baseName });
      }
    }
    return [...seen.values()].sort((x, y) => x.code.localeCompare(y.code, "pt-BR"));
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
            Rodízio: {formatRange(rotationBounds.first, rotationBounds.last)} ·{" "}
            {assignments.length} plantão{assignments.length > 1 ? "ões" : ""}
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
        <>
          <InternCalendar assignments={assignments} onDayPick={handleDayPick} />

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Legenda</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                <Sun className="h-3 w-3" strokeWidth={2} />
                Diurno
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                <Moon className="h-3 w-3" strokeWidth={2} />
                Noturno
              </span>
            </div>
            {basesInUse.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
                {basesInUse.map((b) => {
                  const bs = getBaseStyle(b.type ?? undefined);
                  return (
                    <span key={b.code} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                      <span className={cn("inline-block h-2 w-2 rounded-full", bs.dot)} />
                      <span className="font-semibold">{b.code}</span>
                      <span className="text-slate-400">{b.name}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </>
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
