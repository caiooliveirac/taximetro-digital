"use client";

import { useEffect, useState, useCallback } from "react";
import { Users, CheckCircle, Clock, XCircle, TrendingUp, Sun, Moon, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";
import { getBaseStyle, getPeriodStyle, baseViewIndex } from "@/lib/base-colors";

type Assignment = {
  id: string;
  internName: string;
  facultyAbbr: string;
  baseCode: string;
  baseName: string;
  period: string;
  status: string;
  checkinGeoValid: boolean | null;
  checkinStatus: string | null;
  checkinMethod: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Agendado", CONFIRMED: "Confirmado", CHECKED_IN: "Check-in",
  CHECKED_OUT: "Check-out", ABSENT: "Ausente", CANCELLED: "Cancelado",
};

export default function AdminPresencas() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterBase, setFilterBase] = useState("");
  const [filterFaculty, setFilterFaculty] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPeriod, setFilterPeriod] = useState("");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/taximetro/api/assignments?from=${date}&to=${date}`);
    const json = await res.json();
    if (json.success) setAssignments(json.data);
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); const interval = setInterval(load, 30000); return () => clearInterval(interval); }, [load]);

  function shiftDate(days: number) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  }

  const today = new Date().toISOString().slice(0, 10);
  const isToday = date === today;

  const active = assignments.filter((a) => a.status !== "CANCELLED");
  const checkedIn = active.filter((a) => ["CHECKED_IN", "CHECKED_OUT"].includes(a.status)).length;
  const pending = active.filter((a) => a.status === "SCHEDULED").length;
  const absent = active.filter((a) => a.status === "ABSENT").length;
  const total = active.length;
  const rate = total > 0 ? Math.round((checkedIn / total) * 100) : 0;

  const bases = [...new Set(active.map((a) => a.baseCode))].sort((a, b) => baseViewIndex(a) - baseViewIndex(b));
  const faculties = [...new Set(active.map((a) => a.facultyAbbr))].sort();

  const filtered = active
    .filter((a) =>
      (!filterBase || a.baseCode === filterBase) &&
      (!filterFaculty || a.facultyAbbr === filterFaculty) &&
      (!filterStatus || a.status === filterStatus) &&
      (!filterPeriod || a.period === filterPeriod) &&
      (!search || a.internName.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => {
      const bi = baseViewIndex(a.baseCode) - baseViewIndex(b.baseCode);
      if (bi !== 0) return bi;
      if (a.period !== b.period) return a.period === "DAY" ? -1 : 1;
      return a.internName.localeCompare(b.internName);
    });

  const selectCls = "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Presenças</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftDate(-1)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          />
          <button onClick={() => shiftDate(1)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isToday && (
            <button onClick={() => setDate(today)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-accent-600 hover:bg-accent-50 transition-colors">
              Hoje
            </button>
          )}
          <span className="flex items-center gap-1 text-xs text-slate-400 ml-1">
            <RefreshCw className="h-3 w-3" strokeWidth={1.5} /> 30s
          </span>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <MetricCard label="Total" value={total} icon={Users} />
            <MetricCard label="Presentes" value={checkedIn} icon={CheckCircle} />
            <MetricCard label="Pendentes" value={pending} icon={Clock} />
            <MetricCard label="Ausentes" value={absent} icon={XCircle} />
            <MetricCard label="Taxa presença" value={`${rate}%`} icon={TrendingUp} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Input placeholder="Buscar interno..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" />
            <select value={filterBase} onChange={(e) => setFilterBase(e.target.value)} className={selectCls}>
              <option value="">Todas as bases</option>
              {bases.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={filterFaculty} onChange={(e) => setFilterFaculty(e.target.value)} className={selectCls}>
              <option value="">Todas faculdades</option>
              {faculties.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)} className={selectCls}>
              <option value="">Todos turnos</option>
              <option value="DAY">Diurno</option>
              <option value="NIGHT">Noturno</option>
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={selectCls}>
              <option value="">Todos status</option>
              {Object.entries(STATUS_LABEL).filter(([k]) => k !== "CANCELLED").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Interno</TableHead>
                  <TableHead>Faculdade</TableHead>
                  <TableHead>Base</TableHead>
                  <TableHead>Turno</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => {
                  const bs = getBaseStyle(undefined);
                  const ps = getPeriodStyle(a.period);
                  // Row background by status/checkin errors
                  const rowBg =
                    a.status === "ABSENT" ? "bg-red-50" :
                    ["CHECKED_IN", "CHECKED_OUT"].includes(a.status) && a.checkinGeoValid === false ? "bg-purple-50" :
                    ["CHECKED_IN", "CHECKED_OUT"].includes(a.status) && a.checkinStatus === "EXPIRED" ? "bg-violet-50" :
                    ["CHECKED_IN", "CHECKED_OUT"].includes(a.status) && a.checkinMethod === "TELEGRAM_QR" && a.checkinStatus === "REJECTED" ? "bg-fuchsia-50" :
                    ["CHECKED_IN", "CHECKED_OUT"].includes(a.status) ? "bg-emerald-50" :
                    "";
                  return (
                    <TableRow key={a.id} className={rowBg}>
                      <TableCell className="font-medium">{a.internName}</TableCell>
                      <TableCell className="text-xs text-slate-500">{a.facultyAbbr}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          <span className={`inline-block h-2 w-2 rounded-full ${bs.dot}`} />
                          {a.baseCode} — {a.baseName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${ps.bg} ${ps.text}`}>
                          {a.period === "DAY" ? <Sun className="h-3 w-3" strokeWidth={1.5} /> : <Moon className="h-3 w-3" strokeWidth={1.5} />}
                          {ps.label}
                        </span>
                      </TableCell>
                      <TableCell><StatusBadge status={a.status} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filtered.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nenhum resultado para os filtros selecionados.</p>}
            <div className="border-t border-slate-100 px-4 py-2 flex items-center justify-between">
              <p className="text-xs text-slate-400">{filtered.length} de {active.length} registros</p>
              <div className="flex items-center gap-3 text-[10px] text-slate-500">
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-emerald-50 border border-emerald-200" /> Presente</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-red-50 border border-red-200" /> Ausente</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-purple-50 border border-purple-200" /> Erro geo</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-violet-50 border border-violet-200" /> TOTP expirado</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-fuchsia-50 border border-fuchsia-200" /> Erro QR</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
