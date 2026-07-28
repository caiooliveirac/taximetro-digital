"use client";

import { useEffect, useState } from "react";
import { Calendar, CheckCircle, XCircle, Ban, TrendingUp, Target, LayoutGrid, List } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";
import { localDateStr } from "@/lib/utils";
import { Heatmap } from "@/components/reports/attendance-report-document";
import type { ReportDocument } from "@/lib/admin-report-builder";

type Assignment = {
  id: string;
  internName: string;
  baseCode: string;
  date: string;
  period: string;
  status: string;
};

type ComplianceRow = {
  userId: string;
  name: string;
  facultyAbbr: string;
  targetShifts: number;
  targetShiftsPerWeek: number;
  totalCompleted: number;
  totalAbsent: number;
  totalHours: number;
  totalPct: number | null;
  thisWeekCompleted: number;
  belowWeeklyTarget: boolean;
  futureScheduled: number;
  rawDeficit: number;
  netDeficit: number;
  status: "ok" | "compensating" | "partial" | "deficit";
};

const SHIFT_HOURS = 12;
const today = localDateStr();

export default function LeaderRelatorios() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [compliance, setCompliance] = useState<ComplianceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [datesReady, setDatesReady] = useState(false);
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return localDateStr(d); });
  const [to, setTo] = useState(() => today);
  const [activeTab, setActiveTab] = useState<"table" | "heatmap">("table");
  const [heatmapDocument, setHeatmapDocument] = useState<ReportDocument | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  useEffect(() => {
    fetch("/taximetro/api/leader/cohort")
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data) {
          setFrom(json.data.startDate);
          setTo(json.data.endDate < today ? json.data.endDate : today);
        }
      })
      .catch(() => { /* usa fallback */ })
      .finally(() => setDatesReady(true));
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [res, cRes] = await Promise.all([
        fetch(`/taximetro/api/assignments?from=${from}&to=${to}`),
        fetch("/taximetro/api/compliance"),
      ]);
      const [json, cJson] = await Promise.all([res.json(), cRes.json()]);
      if (json.success) setAssignments(json.data);
      if (cJson.success) setCompliance(cJson.data);
    } catch { /* network error – keep stale data */ }
    setLoading(false);
  }

  async function loadHeatmap() {
    setHeatmapLoading(true);
    try {
      const res = await fetch(`/taximetro/api/leader/heatmap?from=${from}&to=${to}`);
      const json = await res.json();
      if (json.success) setHeatmapDocument(json.data as ReportDocument);
    } catch { /* network error */ }
    setHeatmapLoading(false);
  }

  useEffect(() => { if (datesReady) void load(); }, [from, to, datesReady]);

  useEffect(() => {
    if (datesReady && activeTab === "heatmap") void loadHeatmap();
  }, [activeTab, from, to, datesReady]);

  const active = assignments.filter((a) => a.status !== "CANCELLED");
  const total = active.length;
  const present = active.filter((a) => ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(a.status)).length;
  const absent = active.filter((a) => a.status === "ABSENT").length;
  const cancelled = assignments.filter((a) => a.status === "CANCELLED").length;
  const presenceRate = total > 0 ? Math.round((present / total) * 100) : 0;

  // Per-intern stats from assignments in selected range
  const internMap = new Map<string, { total: number; present: number; absent: number; hours: number }>();
  for (const a of active) {
    const entry = internMap.get(a.internName) ?? { total: 0, present: 0, absent: 0, hours: 0 };
    entry.total++;
    if (["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(a.status)) {
      entry.present++;
      entry.hours += SHIFT_HOURS;
    }
    if (a.status === "ABSENT") entry.absent++;
    internMap.set(a.internName, entry);
  }

  const interns = [...internMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Merge compliance data by name for progress bars
  const complianceByName = new Map(compliance.map((c) => [c.name, c]));
  const hasTargets = compliance.some((c) => c.targetShifts > 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Relatórios</h1>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="block">
          <span className="text-xs font-medium text-slate-500">De</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Até</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
        </label>
      </div>

      {loading ? <TableSkeleton rows={2} cols={5} /> : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <MetricCard label="Total de plantões" value={total} icon={Calendar} />
          <MetricCard label="Presentes" value={present} icon={CheckCircle} />
          <MetricCard label="Ausentes" value={absent} icon={XCircle} />
          <MetricCard label="Cancelados" value={cancelled} icon={Ban} />
          <MetricCard label="Taxa presença" value={`${presenceRate}%`} icon={TrendingUp} className="col-span-2 sm:col-span-1" />
        </div>
      )}

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("table")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${activeTab === "table" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          <List className="h-4 w-4" />
          Por interno
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("heatmap")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${activeTab === "heatmap" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          <LayoutGrid className="h-4 w-4" />
          Heatmap
        </button>
      </div>

      {activeTab === "table" && (
        loading ? <TableSkeleton rows={6} cols={5} /> : (
          <>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium text-slate-900">Por Interno</h2>
              {hasTargets && (
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <Target className="h-3 w-3" strokeWidth={1.5} />
                  Progresso total (meta da faculdade)
                </span>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Interno</TableHead>
                    <TableHead className="text-center">Plantões</TableHead>
                    <TableHead className="text-center">Presentes</TableHead>
                    <TableHead className="text-center">Ausentes</TableHead>
                    <TableHead className="text-center">Horas</TableHead>
                    {hasTargets && <TableHead className="text-center">Progresso Total</TableHead>}
                    {hasTargets && <TableHead className="text-center">Semanal</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {interns.map(([name, s]) => {
                    const c = complianceByName.get(name);
                    const shiftPct = c?.totalPct ?? null;
                    return (
                      <TableRow key={name}>
                        <TableCell className="font-medium">{name}</TableCell>
                        <TableCell className="text-center">{s.total}</TableCell>
                        <TableCell className="text-center text-emerald-600 font-medium">{s.present}</TableCell>
                        <TableCell className="text-center text-red-600 font-medium">{s.absent}</TableCell>
                        <TableCell className="text-center">{s.hours}h</TableCell>
                        {hasTargets && (
                          <TableCell className="text-center">
                            {shiftPct !== null ? (
                              <div className="mx-auto flex w-24 items-center gap-1.5">
                                <div className="h-2 flex-1 rounded-full bg-slate-100">
                                  <div
                                    className={`h-2 rounded-full transition-all ${shiftPct >= 100 ? "bg-emerald-500" : shiftPct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                                    style={{ width: `${shiftPct}%` }}
                                  />
                                </div>
                                <span className="text-xs text-slate-500 tabular-nums">{shiftPct}%</span>
                              </div>
                            ) : "—"}
                          </TableCell>
                        )}
                        {hasTargets && (
                          <TableCell className="text-center">
                            {c && c.targetShiftsPerWeek > 0 ? (
                              c.status === "ok" ? (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700">OK</span>
                              ) : c.status === "compensating" ? (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">Compensando</span>
                              ) : c.status === "partial" ? (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700">−{c.netDeficit}</span>
                              ) : (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700">−{c.rawDeficit}</span>
                              )
                            ) : "—"}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {interns.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nenhum dado no período.</p>}
            </div>
          </>
        )
      )}

      {activeTab === "heatmap" && (
        heatmapLoading ? <TableSkeleton rows={8} cols={10} /> : heatmapDocument ? (
          <Heatmap document={heatmapDocument} assignmentDetailPath="/taximetro/api/leader/assignments" />
        ) : (
          <p className="py-8 text-center text-sm text-slate-400">Nenhum dado no período.</p>
        )
      )}
    </div>
  );
}
