"use client";

import { useEffect, useState, useRef } from "react";
import {
  Calendar, CheckCircle, XCircle, Ban, TrendingUp, Target, Download,
  User, Building2, Sun, Moon, Filter, FileText, Printer,
} from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";
import { getFacultyStyle, baseViewIndex } from "@/lib/base-colors";
import { localDateStr } from "@/lib/utils";

type Assignment = {
  id: string; internId: string; internName: string; baseCode: string;
  date: string; period: string; status: string; facultyAbbr: string;
};
type ComplianceRow = {
  userId: string; name: string; facultyAbbr: string;
  targetShifts: number; targetShiftsPerWeek: number;
  totalCompleted: number; totalAbsent: number; totalHours: number;
  totalPct: number | null; thisWeekCompleted: number; thisWeekAbsent: number;
  rawDeficit: number; netDeficit: number; futureScheduled: number;
  status: "ok" | "compensating" | "partial" | "deficit";
};

const SHIFT_HOURS = 12;
const STATUS_LABEL: Record<string, string> = {
  ok: "OK", compensating: "Compensando", partial: "Parcial", deficit: "Déficit",
};

type ReportMode = "geral" | "individual";
type Section = "kpis" | "porInterno" | "porBase" | "porFaculdade" | "detalhado";

export default function AdminRelatorios() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [compliance, setCompliance] = useState<ComplianceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(1);
    return localDateStr(d);
  });
  const [to, setTo] = useState(() => localDateStr());

  /* filters */
  const [facultyFilter, setFacultyFilter] = useState<string>("");
  const [mode, setMode] = useState<ReportMode>("geral");
  const [selectedIntern, setSelectedIntern] = useState<string>("");
  const [sections, setSections] = useState<Record<Section, boolean>>({
    kpis: true, porInterno: true, porBase: true, porFaculdade: true, detalhado: false,
  });

  const printRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => { load(); }, [from, to]);

  /* derived data */
  const active = assignments.filter((a) => a.status !== "CANCELLED");
  const filtered = facultyFilter
    ? active.filter((a) => a.facultyAbbr === facultyFilter)
    : active;

  const faculties = [...new Set(active.map((a) => a.facultyAbbr))].sort();

  const total = filtered.length;
  const present = filtered.filter((a) => ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(a.status)).length;
  const absent = filtered.filter((a) => a.status === "ABSENT").length;
  const cancelled = assignments.filter((a) => a.status === "CANCELLED" && (!facultyFilter || a.facultyAbbr === facultyFilter)).length;
  const presenceRate = total > 0 ? Math.round((present / total) * 100) : 0;

  /* per-intern stats */
  const internMap = new Map<string, { id: string; name: string; faculty: string; total: number; present: number; absent: number; hours: number }>();
  for (const a of filtered) {
    const entry = internMap.get(a.internId) ?? { id: a.internId, name: a.internName, faculty: a.facultyAbbr, total: 0, present: 0, absent: 0, hours: 0 };
    entry.total++;
    if (["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(a.status)) { entry.present++; entry.hours += SHIFT_HOURS; }
    if (a.status === "ABSENT") entry.absent++;
    internMap.set(a.internId, entry);
  }
  const interns = [...internMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const complianceByUser = new Map(compliance.map((c) => [c.userId, c]));

  /* per-base stats */
  const baseMap = new Map<string, { total: number; present: number; absent: number }>();
  for (const a of filtered) {
    const entry = baseMap.get(a.baseCode) ?? { total: 0, present: 0, absent: 0 };
    entry.total++;
    if (["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(a.status)) entry.present++;
    if (a.status === "ABSENT") entry.absent++;
    baseMap.set(a.baseCode, entry);
  }
  const basesArr = [...baseMap.entries()].sort((a, b) => baseViewIndex(a[0]) - baseViewIndex(b[0]));

  /* per-faculty stats */
  const facMap = new Map<string, { total: number; present: number; absent: number; internCount: number }>();
  for (const a of filtered) {
    const entry = facMap.get(a.facultyAbbr) ?? { total: 0, present: 0, absent: 0, internCount: 0 };
    entry.total++;
    if (["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(a.status)) entry.present++;
    if (a.status === "ABSENT") entry.absent++;
    facMap.set(a.facultyAbbr, entry);
  }
  // Intern count per faculty
  const facInternCount = new Map<string, Set<string>>();
  for (const a of filtered) {
    if (!facInternCount.has(a.facultyAbbr)) facInternCount.set(a.facultyAbbr, new Set());
    facInternCount.get(a.facultyAbbr)!.add(a.internId);
  }
  const facsArr = [...facMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  /* individual report */
  const individualIntern = selectedIntern ? interns.find((i) => i.id === selectedIntern) : null;
  const individualCompliance = selectedIntern ? complianceByUser.get(selectedIntern) : null;
  const individualAssignments = selectedIntern
    ? [...filtered.filter((a) => a.internId === selectedIntern)].sort((a, b) => a.date.localeCompare(b.date))
    : [];

  function toggleSection(s: Section) {
    setSections((prev) => ({ ...prev, [s]: !prev[s] }));
  }

  function handlePrint() {
    window.print();
  }

  const selectClass = "block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Relatórios</h1>
          <p className="mt-1 text-sm text-slate-500">Configure o relatório conforme a necessidade — geral ou individual.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-1" strokeWidth={1.5} /> Imprimir / PDF
        </Button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end print:hidden">
        <label className="block">
          <span className="text-xs font-medium text-slate-500">De</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-40" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Até</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-40" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Modo</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as ReportMode)} className={`${selectClass} mt-1`}>
            <option value="geral">Geral</option>
            <option value="individual">Individual (por nome)</option>
          </select>
        </label>
        {mode === "geral" && (
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Faculdade</span>
            <select value={facultyFilter} onChange={(e) => setFacultyFilter(e.target.value)} className={`${selectClass} mt-1`}>
              <option value="">Todas</option>
              {faculties.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        )}
        {mode === "individual" && (
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Interno</span>
            <select value={selectedIntern} onChange={(e) => setSelectedIntern(e.target.value)} className={`${selectClass} mt-1 min-w-[220px]`}>
              <option value="">Selecionar interno...</option>
              {interns.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.faculty})</option>)}
            </select>
          </label>
        )}
      </div>

      {/* Section toggles (for geral mode) */}
      {mode === "geral" && (
        <div className="flex flex-wrap gap-2 print:hidden">
          <span className="text-xs font-medium text-slate-500 self-center mr-1">Seções:</span>
          {([
            ["kpis", "KPIs"],
            ["porInterno", "Por Interno"],
            ["porBase", "Por Base"],
            ["porFaculdade", "Por Faculdade"],
            ["detalhado", "Detalhado"],
          ] as [Section, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => toggleSection(key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${sections[key]
                ? "bg-accent-50 text-accent-700 ring-1 ring-accent-600/10"
                : "bg-slate-100 text-slate-400"
                }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {loading ? <TableSkeleton rows={6} cols={5} /> : (
        <div ref={printRef}>
          {/* Print header */}
          <div className="hidden print:block mb-4">
            <h1 className="text-xl font-bold text-black">
              {mode === "individual" && individualIntern
                ? `Relatório Individual — ${individualIntern.name}`
                : `Relatório ${facultyFilter || "Geral"}`}
            </h1>
            <p className="text-sm text-gray-600">Período: {from} a {to}</p>
            <p className="text-xs text-gray-400">Gerado em {new Date().toLocaleDateString("pt-BR")} às {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
          </div>

          {/* ══════ GENERAL MODE ══════ */}
          {mode === "geral" && (
            <>
              {/* KPIs */}
              {sections.kpis && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 mb-6 print:grid-cols-5">
                  <MetricCard label="Total plantões" value={total} icon={Calendar} />
                  <MetricCard label="Presentes" value={present} icon={CheckCircle} />
                  <MetricCard label="Ausentes" value={absent} icon={XCircle} />
                  <MetricCard label="Cancelados" value={cancelled} icon={Ban} />
                  <MetricCard label="Taxa presença" value={`${presenceRate}%`} icon={TrendingUp} />
                </div>
              )}

              {/* Per Intern */}
              {sections.porInterno && (
                <div className="mb-6">
                  <h2 className="text-base font-medium text-slate-900 mb-2">Por Interno</h2>
                  <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] print:shadow-none print:border-gray-300">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Interno</TableHead>
                          <TableHead>Faculdade</TableHead>
                          <TableHead className="text-center">Plantões</TableHead>
                          <TableHead className="text-center">Presentes</TableHead>
                          <TableHead className="text-center">Ausentes</TableHead>
                          <TableHead className="text-center">Horas</TableHead>
                          <TableHead className="text-center">Progresso</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {interns.map((s) => {
                          const c = complianceByUser.get(s.id);
                          const pct = c?.totalPct ?? null;
                          const fs = getFacultyStyle(s.faculty);
                          return (
                            <TableRow key={s.id}>
                              <TableCell className="font-medium">{s.name}</TableCell>
                              <TableCell>
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${fs.pill}`}>{s.faculty}</span>
                              </TableCell>
                              <TableCell className="text-center">{s.total}</TableCell>
                              <TableCell className="text-center text-emerald-600 font-medium">{s.present}</TableCell>
                              <TableCell className="text-center text-red-600 font-medium">{s.absent}</TableCell>
                              <TableCell className="text-center">{s.hours}h</TableCell>
                              <TableCell className="text-center">
                                {pct !== null ? (
                                  <div className="mx-auto flex w-20 items-center gap-1">
                                    <div className="h-2 flex-1 rounded-full bg-slate-100">
                                      <div
                                        className={`h-2 rounded-full ${pct >= 100 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                                        style={{ width: `${Math.min(100, pct)}%` }}
                                      />
                                    </div>
                                    <span className="text-[10px] text-slate-500 tabular-nums">{pct}%</span>
                                  </div>
                                ) : "—"}
                              </TableCell>
                              <TableCell className="text-center">
                                {c ? (
                                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${c.status === "ok" ? "bg-emerald-50 text-emerald-700" :
                                    c.status === "compensating" ? "bg-blue-50 text-blue-700" :
                                      c.status === "partial" ? "bg-amber-50 text-amber-700" :
                                        "bg-red-50 text-red-700"
                                    }`}>{STATUS_LABEL[c.status]}</span>
                                ) : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    {interns.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nenhum dado no período.</p>}
                    <div className="border-t border-slate-100 px-4 py-2 print:hidden">
                      <span className="text-xs text-slate-400">{interns.length} interno(s)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Per Base */}
              {sections.porBase && (
                <div className="mb-6">
                  <h2 className="text-base font-medium text-slate-900 mb-2">Por Base</h2>
                  <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] print:shadow-none">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Base</TableHead>
                          <TableHead className="text-center">Plantões</TableHead>
                          <TableHead className="text-center">Presentes</TableHead>
                          <TableHead className="text-center">Ausentes</TableHead>
                          <TableHead className="text-center">Taxa</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {basesArr.map(([code, s]) => (
                          <TableRow key={code}>
                            <TableCell className="font-medium">{code}</TableCell>
                            <TableCell className="text-center">{s.total}</TableCell>
                            <TableCell className="text-center text-emerald-600 font-medium">{s.present}</TableCell>
                            <TableCell className="text-center text-red-600 font-medium">{s.absent}</TableCell>
                            <TableCell className="text-center">{s.total > 0 ? Math.round((s.present / s.total) * 100) : 0}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Per Faculty */}
              {sections.porFaculdade && !facultyFilter && (
                <div className="mb-6">
                  <h2 className="text-base font-medium text-slate-900 mb-2">Por Faculdade</h2>
                  <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] print:shadow-none">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Faculdade</TableHead>
                          <TableHead className="text-center">Internos</TableHead>
                          <TableHead className="text-center">Plantões</TableHead>
                          <TableHead className="text-center">Presentes</TableHead>
                          <TableHead className="text-center">Ausentes</TableHead>
                          <TableHead className="text-center">Taxa</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {facsArr.map(([abbr, s]) => {
                          const fs = getFacultyStyle(abbr);
                          return (
                            <TableRow key={abbr}>
                              <TableCell>
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${fs.pill}`}>{abbr}</span>
                              </TableCell>
                              <TableCell className="text-center">{facInternCount.get(abbr)?.size ?? 0}</TableCell>
                              <TableCell className="text-center">{s.total}</TableCell>
                              <TableCell className="text-center text-emerald-600 font-medium">{s.present}</TableCell>
                              <TableCell className="text-center text-red-600 font-medium">{s.absent}</TableCell>
                              <TableCell className="text-center">{s.total > 0 ? Math.round((s.present / s.total) * 100) : 0}%</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Detailed (all rows) — opt-in */}
              {sections.detalhado && (
                <div className="mb-6">
                  <h2 className="text-base font-medium text-slate-900 mb-2">Detalhado</h2>
                  <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] print:shadow-none max-h-[60vh] overflow-y-auto print:max-h-none print:overflow-visible">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Interno</TableHead>
                          <TableHead>Faculdade</TableHead>
                          <TableHead>Base</TableHead>
                          <TableHead>Turno</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...filtered].sort((a, b) => a.date.localeCompare(b.date) || baseViewIndex(a.baseCode) - baseViewIndex(b.baseCode)).map((a) => (
                          <TableRow key={a.id}>
                            <TableCell className="text-xs">{new Date(a.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</TableCell>
                            <TableCell className="font-medium text-sm">{a.internName}</TableCell>
                            <TableCell><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getFacultyStyle(a.facultyAbbr).pill}`}>{a.facultyAbbr}</span></TableCell>
                            <TableCell>{a.baseCode}</TableCell>
                            <TableCell>
                              <span className="flex items-center gap-1 text-xs">
                                {a.period === "DAY" ? <Sun className="h-3 w-3 text-amber-500" strokeWidth={1.5} /> : <Moon className="h-3 w-3 text-indigo-500" strokeWidth={1.5} />}
                                {a.period === "DAY" ? "D" : "N"}
                              </span>
                            </TableCell>
                            <TableCell><Badge variant={a.status === "ABSENT" ? "absent" : ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(a.status) ? "confirmed" : "scheduled"}>{a.status}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div className="border-t border-slate-100 px-4 py-2 print:hidden">
                      <span className="text-xs text-slate-400">{filtered.length} registro(s)</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ══════ INDIVIDUAL MODE ══════ */}
          {mode === "individual" && individualIntern && (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] print:shadow-none print:border-gray-300">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                    <User className="h-5 w-5 text-slate-500" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{individualIntern.name}</h2>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getFacultyStyle(individualIntern.faculty).pill}`}>
                      {individualIntern.faculty}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-500">Plantões</p>
                    <p className="text-xl font-bold text-slate-900">{individualIntern.total}</p>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-3">
                    <p className="text-[11px] text-emerald-600">Presentes</p>
                    <p className="text-xl font-bold text-emerald-700">{individualIntern.present}</p>
                  </div>
                  <div className="rounded-lg bg-red-50 p-3">
                    <p className="text-[11px] text-red-600">Ausentes</p>
                    <p className="text-xl font-bold text-red-700">{individualIntern.absent}</p>
                  </div>
                  <div className="rounded-lg bg-blue-50 p-3">
                    <p className="text-[11px] text-blue-600">Horas acumuladas</p>
                    <p className="text-xl font-bold text-blue-700">{individualIntern.hours}h</p>
                  </div>
                </div>

                {/* Compliance */}
                {individualCompliance && individualCompliance.targetShifts > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-700">Progresso Total</p>
                      <span className="text-xs text-slate-500">{individualCompliance.totalCompleted}/{individualCompliance.targetShifts}</span>
                    </div>
                    <div className="h-3 rounded-full bg-slate-100">
                      <div
                        className={`h-3 rounded-full ${(individualCompliance.totalPct ?? 0) >= 100 ? "bg-emerald-500" : (individualCompliance.totalPct ?? 0) >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                        style={{ width: `${Math.min(100, individualCompliance.totalPct ?? 0)}%` }}
                      />
                    </div>
                    <div className="flex gap-4 text-xs text-slate-500">
                      <span>{individualCompliance.totalPct ?? 0}%</span>
                      <span>Meta semanal: {individualCompliance.thisWeekCompleted}/{individualCompliance.targetShiftsPerWeek}</span>
                      <span>Status: <strong className={
                        individualCompliance.status === "ok" ? "text-emerald-600" :
                          individualCompliance.status === "compensating" ? "text-blue-600" :
                            individualCompliance.status === "partial" ? "text-amber-600" : "text-red-600"
                      }>{STATUS_LABEL[individualCompliance.status]}</strong></span>
                      {individualCompliance.rawDeficit > 0 && (
                        <span>Déficit: {individualCompliance.rawDeficit} ({individualCompliance.futureScheduled} agendados)</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Individual detail table */}
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-slate-900 mb-2">Todos os plantões no período</h3>
                <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] print:shadow-none">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Base</TableHead>
                        <TableHead>Turno</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {individualAssignments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-sm">{new Date(a.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}</TableCell>
                          <TableCell className="font-medium">{a.baseCode}</TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1 text-xs">
                              {a.period === "DAY" ? <Sun className="h-3 w-3 text-amber-500" strokeWidth={1.5} /> : <Moon className="h-3 w-3 text-indigo-500" strokeWidth={1.5} />}
                              {a.period === "DAY" ? "Diurno" : "Noturno"}
                            </span>
                          </TableCell>
                          <TableCell><Badge variant={a.status === "ABSENT" ? "absent" : ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(a.status) ? "confirmed" : "scheduled"}>{a.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {individualAssignments.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nenhum plantão no período.</p>}
                  <div className="border-t border-slate-100 px-4 py-2 print:hidden">
                    <span className="text-xs text-slate-400">{individualAssignments.length} plantão(ões)</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {mode === "individual" && !selectedIntern && (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
              <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-sm text-slate-400">Selecione um interno para gerar o relatório individual.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
