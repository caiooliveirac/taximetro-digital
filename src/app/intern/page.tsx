"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, Sun, Moon, Calendar, ArrowRight, Clock, CalendarDays, CircleDot, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { NavigationLinks } from "@/components/navigation-links";
import { getBaseStyle, getPeriodStyle } from "@/lib/base-colors";

type Assignment = {
  id: string;
  baseCode: string;
  baseName: string;
  baseType?: string;
  baseLatitude: number;
  baseLongitude: number;
  date: string;
  period: string;
  status: string;
};

type Slot = {
  baseCode: string;
  baseName: string;
  baseType?: string;
  dayOfWeek: string;
  period: string;
  available: number;
  nextDate: string;
};

type WeeklyCompliance = {
  thisWeekScheduled: number;
  thisWeekCompleted: number;
  thisWeekAbsent: number;
  targetShiftsPerWeek: number;
};

const DAY_LABEL: Record<string, string> = { MON: "Seg", TUE: "Ter", WED: "Qua", THU: "Qui", FRI: "Sex", SAT: "Sáb", SUN: "Dom" };

export default function InternHoje() {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [upcoming, setUpcoming] = useState<Assignment[]>([]);
  const [vacantSlots, setVacantSlots] = useState<Slot[]>([]);
  const [weekly, setWeekly] = useState<WeeklyCompliance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const futureEnd = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  useEffect(() => {
    Promise.all([
      fetch(`/taximetro/api/assignments?from=${today}&to=${futureEnd}`).then((r) => r.json()).catch(() => ({ success: false, data: [] })),
      fetch("/taximetro/api/slots/available").then((r) => r.json()).catch(() => ({ success: false, data: [] })),
      fetch("/taximetro/api/compliance").then((r) => r.json()).catch(() => ({ success: false, data: [] })),
    ]).then(([assignJson, slotsJson, complianceJson]) => {
      if (assignJson.success) {
        const active = assignJson.data.filter((a: Assignment) => a.status !== "CANCELLED");
        const todayAssign = active.find((a: Assignment) => a.date === today);
        setAssignment(todayAssign ?? null);
        setUpcoming(active.filter((a: Assignment) => a.date > today).slice(0, 5));
      } else {
        setError("Não foi possível carregar seus plantões.");
      }
      if (slotsJson.success) {
        setVacantSlots(slotsJson.data.filter((s: Slot) => s.available > 0).slice(0, 6));
      }
      if (complianceJson.success && complianceJson.data.length > 0) {
        const c = complianceJson.data[0];
        setWeekly({
          thisWeekScheduled: c.thisWeekScheduled,
          thisWeekCompleted: c.thisWeekCompleted,
          thisWeekAbsent: c.thisWeekAbsent ?? 0,
          targetShiftsPerWeek: c.targetShiftsPerWeek,
        });
      }
      setLoading(false);
    });
  }, []);

  if (loading) return <p className="text-sm text-slate-400">Carregando...</p>;
  if (error) return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;

  const weeklyEffective = weekly ? weekly.thisWeekScheduled - weekly.thisWeekAbsent : 0;
  const weeklyOnTrack = weekly ? weeklyEffective >= weekly.targetShiftsPerWeek : false;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      {/* Header + weekly goal */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Meu Plantão</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
            <Calendar className="h-3.5 w-3.5" strokeWidth={1.5} />
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        {weekly && weekly.targetShiftsPerWeek > 0 && (
          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${weeklyOnTrack
              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
              : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
            }`}>
            <Target className="h-4 w-4" strokeWidth={2} />
            {weeklyEffective}/{weekly.targetShiftsPerWeek}
          </div>
        )}
      </div>

      {/* Today's assignment */}
      {assignment ? (
        <div className={`rounded-xl border bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-4 ${getBaseStyle(assignment.baseType).border}`}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-slate-500">Base</p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${getBaseStyle(assignment.baseType).dot}`} />
                <p className="text-lg font-semibold text-slate-900">{assignment.baseCode}</p>
              </div>
              <p className="text-sm text-slate-500">{assignment.baseName}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Turno</p>
              <div className={`mt-0.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold ${getPeriodStyle(assignment.period).bg} ${getPeriodStyle(assignment.period).text}`}>
                {assignment.period === "DAY"
                  ? <Sun className="h-4 w-4 text-amber-500" strokeWidth={1.5} />
                  : <Moon className="h-4 w-4 text-indigo-500" strokeWidth={1.5} />}
                {getPeriodStyle(assignment.period).label}
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Status</p>
            <div className="mt-1"><StatusBadge status={assignment.status} /></div>
          </div>
          <NavigationLinks
            latitude={assignment.baseLatitude}
            longitude={assignment.baseLongitude}
            label={`${assignment.baseCode} - ${assignment.baseName}`}
          />
          {assignment.status === "SCHEDULED" && (
            <Link href="/intern/checkin">
              <Button className="w-full gap-2">
                <MapPin className="h-4 w-4" strokeWidth={1.5} />
                Fazer Check-in
                <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <p className="text-sm text-slate-400">Nenhum plantão escalado para hoje.</p>
        </div>
      )}

      {/* Upcoming assignments */}
      {upcoming.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-900">Próximos Plantões</h2>
          </div>
          <div className="space-y-1.5">
            {upcoming.map((a) => {
              const bs = getBaseStyle(a.baseType);
              const ps = getPeriodStyle(a.period);
              return (
                <div key={a.id} className={`flex items-center gap-3 rounded-lg border bg-white px-4 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${bs.border}`}>
                  <span className={`inline-block h-2 w-2 rounded-full ${bs.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{a.baseCode} — {a.baseName}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(a.date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}
                    </p>
                  </div>
                  <div className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${ps.bg} ${ps.text}`}>
                    {a.period === "DAY"
                      ? <Sun className="h-3 w-3" strokeWidth={1.5} />
                      : <Moon className="h-3 w-3" strokeWidth={1.5} />}
                    {ps.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Vacant slots */}
      {vacantSlots.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CircleDot className="h-4 w-4 text-emerald-500" strokeWidth={1.5} />
              <h2 className="text-sm font-semibold text-slate-900">Vagas Disponíveis</h2>
            </div>
            <Link href="/intern/trocas" className="text-xs font-medium text-accent-600 hover:text-accent-700 transition-colors">
              Solicitar extra →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {vacantSlots.map((s, i) => {
              const bs = getBaseStyle(s.baseType);
              const ps = getPeriodStyle(s.period);
              return (
                <div key={i} className={`rounded-lg border bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${bs.border}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block h-2 w-2 rounded-full ${bs.dot}`} />
                    <span className="text-sm font-medium text-slate-900">{s.baseCode}</span>
                    {s.period === "DAY"
                      ? <Sun className={`h-3 w-3 ml-auto ${ps.icon}`} strokeWidth={1.5} />
                      : <Moon className={`h-3 w-3 ml-auto ${ps.icon}`} strokeWidth={1.5} />}
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">{DAY_LABEL[s.dayOfWeek]} — {s.available} vaga{s.available > 1 ? "s" : ""}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
