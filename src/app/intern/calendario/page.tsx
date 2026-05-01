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

const DONE_STATUSES = new Set(["CHECKED_OUT", "VALIDATED", "APPROVED"]);
const IN_PROGRESS_STATUSES = new Set(["CHECKED_IN"]);

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
    const seen = new Map<string, { type?: string | null; code: string; name: string; count: number }>();
    for (const a of assignments) {
      const existing = seen.get(a.baseCode);
      if (existing) {
        existing.count++;
      } else {
        seen.set(a.baseCode, { type: a.baseType, code: a.baseCode, name: a.baseName, count: 1 });
      }
    }
    return [...seen.values()].sort((x, y) => x.code.localeCompare(y.code, "pt-BR"));
  }, [assignments]);

  const progress = useMemo(() => {
    const total = assignments.length;
    if (total === 0) return null;
    const done = assignments.filter((a) => DONE_STATUSES.has(a.status)).length;
    const active = assignments.filter((a) => IN_PROGRESS_STATUSES.has(a.status)).length;
    const absent = assignments.filter((a) => a.status === "ABSENT").length;
    return { total, done, active, absent, pending: total - done - active - absent };
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

          {/* Progress bar */}
          {progress && (
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Progresso</p>
                <p className="text-xs font-semibold text-slate-700">
                  {progress.done} <span className="font-normal text-slate-400">de</span> {progress.total}
                  {" "}<span className="font-normal text-slate-400">concluídos</span>
                </p>
              </div>
              {/* Segmented bar */}
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
                {progress.done > 0 && (
                  <div
                    className="h-full bg-emerald-400 transition-all duration-500"
                    style={{ width: `${(progress.done / progress.total) * 100}%` }}
                  />
                )}
                {progress.active > 0 && (
                  <div
                    className="h-full bg-amber-400"
                    style={{ width: `${(progress.active / progress.total) * 100}%` }}
                  />
                )}
                {progress.absent > 0 && (
                  <div
                    className="h-full bg-red-400"
                    style={{ width: `${(progress.absent / progress.total) * 100}%` }}
                  />
                )}
              </div>
              {/* Legend for the bar */}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {progress.done > 0 && (
                  <ProgressLegendItem color="bg-emerald-400" label="Concluído" count={progress.done} />
                )}
                {progress.active > 0 && (
                  <ProgressLegendItem color="bg-amber-400" label="Em andamento" count={progress.active} />
                )}
                {progress.absent > 0 && (
                  <ProgressLegendItem color="bg-red-400" label="Ausente" count={progress.absent} />
                )}
                {progress.pending > 0 && (
                  <ProgressLegendItem color="bg-slate-200" label="Pendente" count={progress.pending} />
                )}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="rounded-xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            {/* Periods */}
            <div className="border-b border-slate-100 px-4 pt-4 pb-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Turno</p>
              <div className="flex gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200/80">
                  <Sun className="h-3.5 w-3.5" strokeWidth={2} />
                  Diurno
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200/80">
                  <Moon className="h-3.5 w-3.5" strokeWidth={2} />
                  Noturno
                </span>
              </div>
            </div>

            {/* Bases */}
            {basesInUse.length > 0 && (
              <div className="border-b border-slate-100 px-4 pt-3 pb-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Bases</p>
                <div className="space-y-1.5">
                  {basesInUse.map((b) => {
                    const bs = getBaseStyle(b.type ?? undefined);
                    return (
                      <div key={b.code} className="flex items-center gap-2">
                        <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", bs.dot)} />
                        <span className="min-w-[40px] text-xs font-bold text-slate-800">{b.code}</span>
                        <span className="flex-1 text-xs text-slate-500">{b.name}</span>
                        <span className="text-[10px] font-semibold tabular-nums text-slate-400">
                          {b.count}×
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Status dots explanation */}
            <div className="px-4 pt-3 pb-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Status no calendário</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <StatusDotLegendItem color="bg-emerald-400" label="Concluído" />
                <StatusDotLegendItem color="bg-amber-400 animate-pulse" label="Em andamento" />
                <StatusDotLegendItem color="bg-red-400" label="Ausente" />
                <StatusDotLegendItem color="bg-slate-200" label="Agendado" />
              </div>
            </div>
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

function ProgressLegendItem({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
      <span className={cn("inline-block h-2 w-2 rounded-full", color)} />
      {label}
      <span className="font-semibold tabular-nums text-slate-600">({count})</span>
    </span>
  );
}

function StatusDotLegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-slate-600">
      <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", color)} />
      {label}
    </span>
  );
}

function formatRange(first: string, last: string): string {
  const f = new Date(`${first}T12:00:00`);
  const l = new Date(`${last}T12:00:00`);
  const sameYear = f.getFullYear() === l.getFullYear();
  const fFmt = sameYear ? "d MMM" : "d MMM yyyy";
  return `${format(f, fFmt, { locale: ptBR })} – ${format(l, "d MMM yyyy", { locale: ptBR })}`;
}
