"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Sun, Moon, Target, CalendarDays } from "lucide-react";
import { AbsenceJustificationDialog } from "@/components/absence-justification-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBaseStyle, getPeriodStyle } from "@/lib/base-colors";
import { localDateStr } from "@/lib/utils";

type Assignment = {
  id: string;
  baseCode: string;
  baseName: string;
  baseType?: string;
  date: string;
  period: string;
  status: string;
  absenceJustification?: string | null;
  absenceJustificationActor?: string | null;
  absenceJustificationAt?: string | null;
};

type Compliance = {
  targetHours: number;
  targetShifts: number;
  targetShiftsPerWeek: number;
  totalCompleted: number;
  totalAbsent: number;
  totalHours: number;
  totalPct: number | null;
  thisWeekCompleted: number;
  thisWeekScheduled: number;
  lastWeekCompleted: number;
  belowWeeklyTarget: boolean;
  weeklyDeficit: number;
};

export default function InternHistorico() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [justificationAssignment, setJustificationAssignment] = useState<Assignment | null>(null);

  useEffect(() => {
    const to = localDateStr();
    const from = localDateStr(new Date(Date.now() - 90 * 86400000));
    Promise.all([
      fetch(`/taximetro/api/assignments?from=${from}&to=${to}&selfOnly=true`).then((r) => r.json()).catch(() => ({ success: false, data: [] })),
      fetch("/taximetro/api/compliance?selfOnly=true").then((r) => r.json()).catch(() => ({ success: false, data: [] })),
    ]).then(([aJson, cJson]) => {
      if (aJson.success) setAssignments(aJson.data);
      else setError("Não foi possível carregar seu histórico.");
      if (cJson.success && cJson.data.length > 0) setCompliance(cJson.data[0]);
      setLoading(false);
    });
  }, []);

  const completed = assignments.filter((a) => ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(a.status));
  const totalHours = completed.length * 12;

  function handleJustificationSaved(assignmentId: string, data: {
    absenceJustification: string | null;
    absenceJustificationActor: string | null;
    absenceJustificationAt: string | null;
  }) {
    setAssignments((current) => current.map((assignment) => assignment.id === assignmentId ? { ...assignment, ...data } : assignment));
  }

  if (loading) return <p className="text-sm text-slate-400">Carregando...</p>;
  if (error) return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;

  const hoursPct = compliance?.targetHours ? Math.min(Math.round((totalHours / compliance.targetHours) * 100), 100) : null;
  const shiftsPct = compliance?.totalPct ?? null;
  const weeklyPct = compliance?.targetShiftsPerWeek
    ? Math.min(Math.round((compliance.thisWeekCompleted / compliance.targetShiftsPerWeek) * 100), 100)
    : null;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-2xl font-semibold text-slate-900">Histórico</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={1.5} />
            Realizados
          </div>
          <p className="mt-1 text-3xl font-bold text-slate-900">{completed.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Clock className="h-4 w-4 text-accent-500" strokeWidth={1.5} />
            Horas
          </div>
          <p className="mt-1 text-3xl font-bold text-slate-900">{totalHours}h</p>
        </div>
      </div>

      {/* Weekly progress */}
      {compliance && compliance.targetShiftsPerWeek > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-accent-500" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-900">Esta Semana</h2>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>Plantões</span>
              <span className="font-medium text-slate-700">{compliance.thisWeekCompleted} / {compliance.targetShiftsPerWeek}</span>
            </div>
            <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${(weeklyPct ?? 0) >= 100 ? "bg-emerald-500" : (weeklyPct ?? 0) >= 50 ? "bg-accent-500" : "bg-amber-400"}`}
                style={{ width: `${weeklyPct ?? 0}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Progress toward targets */}
      {compliance && (hoursPct !== null || shiftsPct !== null) && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-accent-500" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-900">Progresso Total</h2>
          </div>
          {hoursPct !== null && compliance.targetHours > 0 && (
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>Horas</span>
                <span className="font-medium text-slate-700">{totalHours}h / {compliance.targetHours}h</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${hoursPct >= 100 ? "bg-emerald-500" : hoursPct >= 50 ? "bg-accent-500" : "bg-amber-400"}`}
                  style={{ width: `${hoursPct}%` }}
                />
              </div>
            </div>
          )}
          {shiftsPct !== null && compliance.targetShifts > 0 && (
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>Plantões</span>
                <span className="font-medium text-slate-700">{compliance.totalCompleted} / {compliance.targetShifts}</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${shiftsPct >= 100 ? "bg-emerald-500" : shiftsPct >= 50 ? "bg-accent-500" : "bg-amber-400"}`}
                  style={{ width: `${shiftsPct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* History table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Base</TableHead>
              <TableHead>Turno</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Justificativa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.map((a) => {
              const bs = getBaseStyle(a.baseType);
              const ps = getPeriodStyle(a.period);
              return (
                <TableRow key={a.id}>
                  <TableCell className="text-slate-900">{new Date(a.date).toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-slate-900">
                      <span className={`inline-block h-2 w-2 rounded-full ${bs.dot}`} />
                      {a.baseCode}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${ps.bg} ${ps.text}`}>
                      {a.period === "DAY"
                        ? <Sun className="h-3 w-3" strokeWidth={1.5} />
                        : <Moon className="h-3 w-3" strokeWidth={1.5} />}
                      {a.period === "DAY" ? "D" : "N"}
                    </span>
                  </TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell>
                    {a.status === "ABSENT" ? (
                      <div className="space-y-1">
                        {a.absenceJustification ? (
                          <p className="max-w-[220px] truncate text-xs text-slate-500">{a.absenceJustification}</p>
                        ) : (
                          <p className="text-xs text-amber-600">Sem justificativa</p>
                        )}
                        <button
                          type="button"
                          onClick={() => setJustificationAssignment(a)}
                          className="text-xs font-medium text-accent-600 hover:text-accent-500"
                        >
                          {a.absenceJustification ? "Ver ou editar" : "Justificar falta"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {assignments.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">Nenhum plantão registrado.</p>
        )}
      </div>

      <AbsenceJustificationDialog
        assignment={justificationAssignment ? {
          id: justificationAssignment.id,
          date: justificationAssignment.date,
          period: justificationAssignment.period,
          baseCode: justificationAssignment.baseCode,
          baseName: justificationAssignment.baseName,
          absenceJustification: justificationAssignment.absenceJustification,
          absenceJustificationActor: justificationAssignment.absenceJustificationActor,
          absenceJustificationAt: justificationAssignment.absenceJustificationAt,
        } : null}
        title="Justificar falta"
        onClose={() => setJustificationAssignment(null)}
        onSaved={handleJustificationSaved}
      />
    </div>
  );
}
