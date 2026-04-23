"use client";

import { useEffect } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowRight, MapPin, Moon, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { NavigationLinks } from "@/components/navigation-links";
import { getBaseStyle, getPeriodStyle } from "@/lib/base-colors";
import {
  cn,
  getShiftShortLabel,
  isCurrentOperationalAssignment,
  isWithinAttendanceWindow,
} from "@/lib/utils";
import type { CalendarAssignment } from "./intern-calendar";

type Props = {
  open: boolean;
  dateStr: string | null;
  assignments: CalendarAssignment[];
  onClose: () => void;
};

export function InternDaySheet({ open, dateStr, assignments, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || !dateStr) return null;

  const date = new Date(`${dateStr}T12:00:00`);
  const humanDate = format(date, "EEEE, d 'de' MMMM", { locale: ptBR });
  const plural = assignments.length > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Plantões em ${humanDate}`}
    >
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-lg animate-in slide-in-from-bottom rounded-t-2xl bg-white shadow-xl duration-200">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold capitalize text-slate-900">{humanDate}</p>
            <p className="text-xs text-slate-500">
              {assignments.length} plantão{plural ? "ões" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" strokeWidth={1.8} />
          </button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {assignments.map((a) => (
            <AssignmentCard key={a.id} assignment={a} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AssignmentCard({ assignment: a }: { assignment: CalendarAssignment }) {
  const bs = getBaseStyle(a.baseType ?? undefined);
  const ps = getPeriodStyle(a.period);
  const canCheckIn =
    (a.status === "SCHEDULED" || a.status === "CONFIRMED") &&
    (isWithinAttendanceWindow(a.date, a.period) || isCurrentOperationalAssignment(a.date, a.period));

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]",
        bs.border,
      )}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">Base</p>
          <div className="mt-0.5 flex items-center gap-2">
            <span className={cn("inline-block h-2.5 w-2.5 rounded-full", bs.dot)} />
            <p className="text-base font-semibold text-slate-900">{a.baseCode}</p>
          </div>
          <p className="text-xs text-slate-500">{a.baseName}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Turno</p>
          <div
            className={cn(
              "mt-0.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold",
              ps.bg,
              ps.text,
            )}
          >
            {a.period === "DAY" ? (
              <Sun className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.5} />
            ) : (
              <Moon className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />
            )}
            {a.shift ? getShiftShortLabel(a.shift) : ps.label}
          </div>
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500">Status</p>
        <div className="mt-1">
          <StatusBadge status={a.status} />
        </div>
      </div>
      <NavigationLinks
        latitude={a.baseLatitude}
        longitude={a.baseLongitude}
        label={`${a.baseCode} - ${a.baseName}`}
      />
      {canCheckIn && (
        <Link href={`/intern/checkin?assignmentId=${a.id}`}>
          <Button className="w-full gap-2">
            <MapPin className="h-4 w-4" strokeWidth={1.5} />
            Iniciar check-in
            <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        </Link>
      )}
    </div>
  );
}
