"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Users, Calendar, CalendarDays, CheckCircle, Activity, XCircle, AlertTriangle, Building2, GraduationCap, X, Search, Sun, Moon, UserPlus, TrendingUp, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { InviteButton } from "@/components/invite-button";
import { AdminManualAttendanceActions } from "@/components/admin-manual-attendance-actions";
import { CockpitAlarms, type CockpitData } from "@/components/admin/cockpit-alarms";
import { InternDrawer } from "@/components/admin/intern-drawer";
import { getFacultyStyle, baseViewIndex } from "@/lib/base-colors";
import { formatBrazilTime, localDateStr } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 60_000;

type FacultyOption = { id: string; abbreviation: string; name: string };

type DetailRow = {
  internId?: string | null;
  name: string;
  faculty: string;
  extra: string;
};

type FacultyRow = { abbreviation: string; total: number; present: number; absent: number; pending: number };
type BaseRow = { code: string; name: string; total: number; present: number; absent: number };

type BaseDetailItem = {
  internId?: string | null;
  internName: string;
  faculty: string;
  period: string;
  status: string;
  checkinAt: string | null;
  validatedBy: string | null;
  remanejado: boolean;
};

type ModalData = {
  title: string;
  rows: DetailRow[];
} | null;

type BaseModalData = {
  title: string;
  items: BaseDetailItem[];
} | null;

type WeekDay = { date: string; total: number; present: number; absent: number };

export type DashboardData = {
  s: Record<string, number>;
  checkinRate: number;
  checkinSub: string;
  isDayShiftHours: boolean;
  weekRate: number;
  weekPresent: number;
  weekTotal: number;
  weekDays: WeekDay[];
  faculties: FacultyRow[];
  bases: BaseRow[];
  baseDetails: Record<string, BaseDetailItem[]>;
  dateLabel: string;
  todayRoster: Array<{
    id: string;
    internId?: string | null;
    name: string;
    faculty: string;
    baseCode: string;
    date: string;
    period: "DAY" | "NIGHT";
    status: string;
    remanejado: boolean;
    isCarryover: boolean;
  }>;
  details: {
    absences: DetailRow[];
    incidents: DetailRow[];
    activeCheckins: DetailRow[];
    todayAssignments: DetailRow[];
    checkedIn: DetailRow[];
    todayCompleted: DetailRow[];
    selfAssignments: DetailRow[];
  };
};

const PERIOD_LABEL: Record<string, string> = { DAY: "Diurno", NIGHT: "Noturno" };

export function AdminDashboardClient({
  data,
  cockpit,
  facultyOptions,
  facultyFilter,
}: {
  data: DashboardData;
  cockpit: CockpitData;
  facultyOptions: FacultyOption[];
  facultyFilter: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [modal, setModal] = useState<ModalData>(null);
  const [internModal, setInternModal] = useState<{ id: string; name: string; faculty: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(() => new Date());

  // facultyFilter vem do server (?faculty=ID). Resolvemos abbreviation aqui pra
  // o componente CockpitAlarms filtrar items que carregam apenas o abbr.
  const selectedFacultyAbbr = facultyFilter
    ? facultyOptions.find((f) => f.id === facultyFilter)?.abbreviation ?? null
    : null;

  function triggerRefresh() {
    setRefreshing(true);
    router.refresh();
    setLastRefresh(new Date());
    setTimeout(() => setRefreshing(false), 600);
  }

  function changeFacultyFilter(facultyId: string | null) {
    const url = new URL(window.location.href);
    if (facultyId) url.searchParams.set("faculty", facultyId);
    else url.searchParams.delete("faculty");
    router.push(`${pathname}${url.search}`);
  }

  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh();
      setLastRefresh(new Date());
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router]);

  const [baseModal, setBaseModal] = useState<BaseModalData>(null);
  const [weekModal, setWeekModal] = useState(false);
  const [completedModal, setCompletedModal] = useState(false);
  const [completedDate, setCompletedDate] = useState(() => localDateStr());
  const [completedRows, setCompletedRows] = useState<DetailRow[]>([]);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [todayModal, setTodayModal] = useState(false);
  const [todaySearch, setTodaySearch] = useState("");
  const [todayFilterFaculty, setTodayFilterFaculty] = useState<string | null>(null);
  const [todayFilterBase, setTodayFilterBase] = useState<string | null>(null);
  const [todayFilterPeriod, setTodayFilterPeriod] = useState<"DAY" | "NIGHT" | null>(null);
  const [checkinModal, setCheckinModal] = useState(false);
  const [checkinSearch, setCheckinSearch] = useState("");
  const [checkinFilterFaculty, setCheckinFilterFaculty] = useState<string | null>(null);
  const [checkinFilterBase, setCheckinFilterBase] = useState<string | null>(null);
  const { s, checkinRate, checkinSub, weekRate, weekPresent, weekTotal, weekDays, faculties, bases, baseDetails, dateLabel, details, todayRoster } = data;
  const incidents = (s["geo_violations"] ?? 0) + (s["totp_expired"] ?? 0);

  function openModal(title: string, rows: DetailRow[]) {
    setModal({ title, rows });
  }

  function openBase(b: BaseRow) {
    const items = baseDetails[b.code] ?? [];
    if (items.length > 0) setBaseModal({ title: `${b.code} — ${b.name}`, items });
  }

  const fetchCompleted = useCallback(async (dateStr: string) => {
    const todayStr = localDateStr();
    if (dateStr === todayStr) { setCompletedRows(data.details.todayCompleted); return; }
    setCompletedLoading(true);
    try {
      const res = await fetch(`/taximetro/api/assignments?from=${dateStr}&to=${dateStr}`);
      const json = await res.json();
      if (json.success) {
        type Row = { internId?: string | null; internName: string; facultyAbbr: string; baseCode: string; period: string; status: string };
        setCompletedRows((json.data as Row[])
          .filter((a) => a.status === "CHECKED_OUT")
          .sort((a, b) => baseViewIndex(a.baseCode) - baseViewIndex(b.baseCode))
          .map((a) => ({ internId: a.internId ?? null, name: a.internName, faculty: a.facultyAbbr ?? "", extra: `${a.baseCode} — ${PERIOD_LABEL[a.period] ?? a.period}` })));
      }
    } catch { /* keep current */ }
    setCompletedLoading(false);
  }, [data.details.todayCompleted]);

  function openCompleted() {
    setCompletedDate(localDateStr());
    setCompletedRows(data.details.todayCompleted);
    setCompletedModal(true);
  }

  function changeCompletedDate(delta: number) {
    const d = new Date(completedDate + "T12:00:00");
    d.setDate(d.getDate() + delta);
    const todayStr = localDateStr();
    const sevenAgo = localDateStr(new Date(Date.now() - 7 * 86400000));
    const nd = localDateStr(d);
    if (nd > todayStr || nd < sevenAgo) return;
    setCompletedDate(nd);
    fetchCompleted(nd);
  }

  return (
    <div className="space-y-6 animate-[fadeInUp_200ms_ease-out]">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Cockpit</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
            <span className="capitalize">{dateLabel}</span>
            <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" strokeWidth={1.5} />{s["base_count"] ?? 0} bases</span>
            <span className="flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" strokeWidth={1.5} />{s["faculty_count"] ?? 0} faculdades</span>
            <span className="text-[11px] text-slate-400">
              · atualizado {formatBrazilTime(lastRefresh)}
            </span>
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <select
            value={facultyFilter ?? ""}
            onChange={(e) => changeFacultyFilter(e.target.value || null)}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20 sm:flex-none"
            aria-label="Filtrar por faculdade"
          >
            <option value="">Todas as faculdades</option>
            {facultyOptions.map((f) => (
              <option key={f.id} value={f.id}>{f.abbreviation} — {f.name}</option>
            ))}
          </select>
          <button
            onClick={triggerRefresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98]"
            aria-label="Atualizar agora"
            title="Atualizar agora (auto a cada 60s)"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} strokeWidth={1.75} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
          <InviteButton />
        </div>
      </div>

      {/* Cockpit — alarmes ativos */}
      <CockpitAlarms data={cockpit} facultyFilter={selectedFacultyAbbr} />

      {/* KPI — Operação */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Operação</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MetricCard label="Plantões hoje" value={s["today_assignments"] ?? 0} icon={Calendar}
            className="cursor-pointer" onClick={() => setTodayModal(true)} />
          <MetricCard label="Presença semana" value={`${weekRate}%`} icon={CalendarDays}
            severity={weekRate >= 80 ? "success" : weekRate >= 50 ? "default" : "warning"}
            sub={`${weekPresent} de ${weekTotal}`}
            className="cursor-pointer" onClick={() => setWeekModal(true)} />
          <MetricCard label="Usuários ativos" value={s["total_users"] ?? 0} icon={Users}
            className="cursor-pointer" onClick={() => router.push("/admin/usuarios")} />
        </div>
      </div>

      {/* KPI — Presença */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Presença</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MetricCard label="Taxa check-in" value={`${checkinRate}%`} icon={TrendingUp} severity="success"
            sub={checkinSub}
            className="cursor-pointer" onClick={() => setCheckinModal(true)} />
          <MetricCard label="Ativos agora" value={s["active_checkins"] ?? 0} icon={Activity} severity="success"
            className="cursor-pointer" onClick={() => openModal("Ativos Agora", details.activeCheckins)} />
          <MetricCard label="Concluídos" value={s["completed"] ?? 0} icon={CheckCircle} severity="success"
            className="cursor-pointer" onClick={openCompleted} />
        </div>
      </div>

      {/* KPI — Risco */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Risco</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MetricCard label="Faltas hoje" value={s["today_absences"] ?? 0} icon={XCircle} severity="danger"
            className="cursor-pointer" onClick={() => openModal("Faltas Hoje", details.absences)} />
          <MetricCard label="Check-in irregular" value={incidents} icon={AlertTriangle}
            severity={incidents > 0 ? "warning" : "default"}
            sub={incidents > 0 ? `${s["geo_violations"] ?? 0} geo · ${s["totp_expired"] ?? 0} totp` : undefined}
            className="cursor-pointer" onClick={() => openModal("Check-in sem georreferenciamento / sem validação", details.incidents)} />
          <MetricCard label="Plantão avulso" value={s["self_assignments"] ?? 0} icon={UserPlus}
            severity={(s["self_assignments"] ?? 0) > 0 ? "warning" : "default"}
            className="cursor-pointer" onClick={() => openModal("Plantão Criado pelo Interno", details.selfAssignments)} />
        </div>
      </div>

      {/* Faculty breakdown with progress bars */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Por Faculdade (hoje)</h2>
        {faculties.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">Nenhum plantão hoje.</p>
        ) : (
          <div className="space-y-3">
            {faculties.map((f) => {
              const pct = f.total > 0 ? Math.round((f.present / f.total) * 100) : 0;
              const barColor = f.absent > 0 ? "bg-red-500" : pct >= 80 ? "bg-emerald-500" : "bg-amber-500";
              return (
                <div key={f.abbreviation}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700">{f.abbreviation}</span>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span className="text-emerald-600 font-medium">{f.present} presentes</span>
                      {f.absent > 0 && <span className="text-red-600 font-medium">{f.absent} falta(s)</span>}
                      <span>{f.pending} pend.</span>
                      <span className="font-semibold text-slate-700">{pct}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100">
                    <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Base grid — clickable */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Por Base (hoje)</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {bases.map((b) => {
            const pct = b.total > 0 ? Math.round((b.present / b.total) * 100) : 0;
            return (
              <button key={b.code} onClick={() => openBase(b)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all duration-200 hover:shadow-md hover:-translate-y-px text-left cursor-pointer">
                <p className="text-xs text-slate-500 font-medium">{b.code} — {b.name}</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-xl font-bold tabular-nums text-slate-900">{b.present}</span>
                  <span className="text-xs text-slate-400">/ {b.total}</span>
                  {b.absent > 0 && <span className="text-xs text-red-600 font-medium">({b.absent} falta)</span>}
                </div>
                <div className="mt-2 h-1 w-full rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${b.absent > 0 ? "bg-red-400" : "bg-emerald-400"}`} style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail Modal */}
      {modal && (() => {
        const filteredRows = modal.rows.filter(r =>
          !search || r.name.toLowerCase().includes(search.toLowerCase())
        );
        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => { setModal(null); setSearch(""); }}>
            <div className="relative mx-0 max-h-[85dvh] w-full max-w-lg overflow-hidden rounded-t-2xl sm:mx-4 sm:max-h-[70vh] sm:rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">{modal.title}</h3>
                <button onClick={() => { setModal(null); setSearch(""); }} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {modal.rows.length > 5 && (
                <div className="px-5 pt-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar por nome..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                </div>
              )}
              <div className="max-h-[55vh] overflow-y-auto px-5 py-3">
                {filteredRows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">Nenhum registro.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {filteredRows.map((r, i) => {
                      const fst = getFacultyStyle(r.faculty);
                      const clickable = !!r.internId;
                      return (
                        <li key={i} className="flex items-center justify-between py-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            {clickable ? (
                              <button
                                type="button"
                                onClick={() => setInternModal({ id: r.internId!, name: r.name, faculty: r.faculty })}
                                className="truncate text-left text-sm font-medium text-slate-800 hover:text-accent-700 hover:underline"
                              >
                                {r.name}
                              </button>
                            ) : (
                              <span className="text-sm font-medium text-slate-800 truncate">{r.name}</span>
                            )}
                            {r.faculty && (
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fst.pill}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                                {r.faculty}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-slate-500 shrink-0 ml-2">{r.extra}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Plantões Hoje Modal */}
      {todayModal && (() => {
        const rows = todayRoster;
        const allFaculties = [...new Set(rows.map(r => r.faculty).filter(Boolean))].sort();
        const allBases = [...new Set(rows.map(r => r.baseCode).filter(Boolean))].sort((a, b) => baseViewIndex(a) - baseViewIndex(b));
        const STATUS_LABEL: Record<string, string> = { SCHEDULED: "Escalado", CONFIRMED: "Confirmado", CHECKED_IN: "Presente", CHECKED_OUT: "Finalizado", ABSENT: "Ausente" };

        const filtered = rows.filter(r => {
          if (todaySearch && !r.name.toLowerCase().includes(todaySearch.toLowerCase())) return false;
          if (todayFilterFaculty && r.faculty !== todayFilterFaculty) return false;
          if (todayFilterBase && r.baseCode !== todayFilterBase) return false;
          if (todayFilterPeriod && r.period !== todayFilterPeriod) return false;
          return true;
        });

        const diurno = filtered.filter(r => r.period === "DAY").sort((a, b) => baseViewIndex(a.baseCode) - baseViewIndex(b.baseCode));
        const noturno = filtered.filter(r => r.period === "NIGHT").sort((a, b) => baseViewIndex(a.baseCode) - baseViewIndex(b.baseCode));

        function closeTodayModal() { setTodayModal(false); setTodaySearch(""); setTodayFilterFaculty(null); setTodayFilterBase(null); setTodayFilterPeriod(null); }

        function renderRosterRow(r: typeof rows[0], i: number) {
          const fst = getFacultyStyle(r.faculty);
          const statusLabel = STATUS_LABEL[r.status] ?? r.status;
          const statusColor = r.status === "ABSENT" ? "text-red-600 font-medium" : r.status === "CHECKED_IN" || r.status === "CHECKED_OUT" ? "text-emerald-600" : "text-slate-400";
          return (
            <li key={i} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2 min-w-0">
                {r.internId ? (
                  <button
                    type="button"
                    onClick={() => setInternModal({ id: r.internId!, name: r.name, faculty: r.faculty })}
                    className="truncate text-left text-sm font-medium text-slate-800 hover:text-accent-700 hover:underline"
                  >
                    {r.name}
                  </button>
                ) : (
                  <span className="text-sm font-medium text-slate-800 truncate">{r.name}</span>
                )}
                {r.remanejado && (
                  <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                    Remanejado
                  </span>
                )}
                {r.faculty && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fst.pill}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                    {r.faculty}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className={`text-[10px] ${statusColor}`}>{statusLabel}</span>
                <span className="text-xs text-slate-500">{r.baseCode}</span>
              </div>
            </li>
          );
        }

        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={closeTodayModal}>
            <div className="relative mx-0 max-h-[88dvh] w-full max-w-lg overflow-hidden rounded-t-2xl sm:mx-4 sm:max-h-[85vh] sm:rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">Plantões Hoje — {filtered.length}</h3>
                <button onClick={closeTodayModal} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="border-b border-slate-100 px-5 py-3 space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input type="text" placeholder="Buscar por nome..." value={todaySearch} onChange={(e) => setTodaySearch(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <button onClick={() => setTodayFilterPeriod(todayFilterPeriod === "DAY" ? null : "DAY")}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-all cursor-pointer border ${todayFilterPeriod === "DAY" ? "border-amber-300 bg-amber-50 text-amber-700 ring-1 ring-amber-200" : todayFilterPeriod ? "border-slate-200 text-slate-400 opacity-50" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    <Sun className="h-3 w-3 text-amber-500" strokeWidth={1.5} /> Diurno ({rows.filter(r => r.period === "DAY").length})
                  </button>
                  <button onClick={() => setTodayFilterPeriod(todayFilterPeriod === "NIGHT" ? null : "NIGHT")}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-all cursor-pointer border ${todayFilterPeriod === "NIGHT" ? "border-indigo-300 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200" : todayFilterPeriod ? "border-slate-200 text-slate-400 opacity-50" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    <Moon className="h-3 w-3 text-indigo-500" strokeWidth={1.5} /> Noturno ({rows.filter(r => r.period === "NIGHT").length})
                  </button>
                  <span className="text-slate-300 mx-0.5">|</span>
                  {allBases.map(b => (
                    <button key={b} onClick={() => setTodayFilterBase(todayFilterBase === b ? null : b)}
                      className={`rounded-full px-2 py-1 font-medium transition-all cursor-pointer border ${todayFilterBase === b ? "border-accent-300 bg-accent-50 text-accent-700 ring-1 ring-accent-200" : todayFilterBase ? "border-slate-200 text-slate-400 opacity-50" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      {b}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {allFaculties.map(f => {
                    const fst = getFacultyStyle(f);
                    const active = todayFilterFaculty === f;
                    return (
                      <button key={f} onClick={() => setTodayFilterFaculty(active ? null : f)}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all cursor-pointer ${fst.pill} ${active ? "ring-2 ring-offset-1 scale-105" : todayFilterFaculty ? "opacity-30" : ""}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />{f}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="max-h-[55vh] overflow-y-auto px-5 py-3">
                {filtered.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">Nenhum registro.</p>
                ) : (
                  <div className="space-y-4">
                    {diurno.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <Sun className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.5} />
                          <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Diurno — {diurno.length}</span>
                        </div>
                        <ul className="divide-y divide-slate-100">{diurno.map(renderRosterRow)}</ul>
                      </div>
                    )}
                    {noturno.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <Moon className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />
                          <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">Noturno — {noturno.length}</span>
                        </div>
                        <ul className="divide-y divide-slate-100">{noturno.map(renderRosterRow)}</ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Check-ins Hoje Modal */}
      {checkinModal && (() => {
        const rows = todayRoster;
        const allFaculties = [...new Set(rows.map(r => r.faculty).filter(Boolean))].sort();
        const allBases = [...new Set(rows.map(r => r.baseCode).filter(Boolean))].sort((a, b) => baseViewIndex(a) - baseViewIndex(b));
        const CHECKED_STATUSES = new Set(["CHECKED_IN", "CHECKED_OUT"]);
        const STATUS_LABEL: Record<string, string> = { SCHEDULED: "Escalado", CONFIRMED: "Confirmado", CHECKED_IN: "Check-in feito", CHECKED_OUT: "Finalizado", ABSENT: "Ausente" };

        const filtered = rows.filter(r => {
          if (checkinSearch && !r.name.toLowerCase().includes(checkinSearch.toLowerCase())) return false;
          if (checkinFilterFaculty && r.faculty !== checkinFilterFaculty) return false;
          if (checkinFilterBase && r.baseCode !== checkinFilterBase) return false;
          return true;
        });

        const checkedIn = filtered.filter(r => CHECKED_STATUSES.has(r.status)).sort((a, b) => baseViewIndex(a.baseCode) - baseViewIndex(b.baseCode));
        const notCheckedIn = filtered.filter(r => !CHECKED_STATUSES.has(r.status) && r.status !== "ABSENT" && r.status !== "CANCELLED").sort((a, b) => baseViewIndex(a.baseCode) - baseViewIndex(b.baseCode));
        const absent = filtered.filter(r => r.status === "ABSENT").sort((a, b) => baseViewIndex(a.baseCode) - baseViewIndex(b.baseCode));

        // Group by period when showing both
        const dayNotChecked = notCheckedIn.filter(r => r.period === "DAY");
        const nightNotChecked = notCheckedIn.filter(r => r.period === "NIGHT");
        const dayChecked = checkedIn.filter(r => r.period === "DAY");
        const nightChecked = checkedIn.filter(r => r.period === "NIGHT");

        function closeCheckinModal() { setCheckinModal(false); setCheckinSearch(""); setCheckinFilterFaculty(null); setCheckinFilterBase(null); }

        function renderCheckinRow(r: typeof rows[0], i: number) {
          const fst = getFacultyStyle(r.faculty);
          const statusLabel = STATUS_LABEL[r.status] ?? r.status;
          const statusClass = r.status === "ABSENT"
            ? "border-red-200 bg-red-50 text-red-700"
            : CHECKED_STATUSES.has(r.status)
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-700";
          return (
            <li key={i} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2 min-w-0">
                  {r.period === "DAY"
                    ? <Sun className="mt-0.5 h-3.5 w-3.5 text-amber-500 shrink-0" strokeWidth={1.5} />
                    : <Moon className="mt-0.5 h-3.5 w-3.5 text-indigo-500 shrink-0" strokeWidth={1.5} />}
                  {r.internId ? (
                    <button
                      type="button"
                      onClick={() => setInternModal({ id: r.internId!, name: r.name, faculty: r.faculty })}
                      className="text-left text-[15px] font-semibold leading-snug text-slate-900 break-words hover:text-accent-700 hover:underline"
                    >
                      {r.name}
                    </button>
                  ) : (
                    <span className="text-[15px] font-semibold leading-snug text-slate-900 break-words">{r.name}</span>
                  )}
                  {r.faculty && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fst.pill}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />{r.faculty}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">{r.baseCode}</span>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusClass}`}>{statusLabel}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{new Date(`${r.date}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" })}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{r.period === "DAY" ? "Diurno" : "Noturno"}</span>
                  {r.isCarryover && (
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                      Janela estendida
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 pt-0.5">
                <AdminManualAttendanceActions
                  assignmentId={r.id}
                  status={r.status}
                  compact
                  onUpdated={() => router.refresh()}
                />
              </div>
            </li>
          );
        }

        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={closeCheckinModal}>
            <div className="relative mx-0 max-h-[90dvh] w-full max-w-5xl overflow-hidden rounded-t-2xl sm:mx-2 sm:max-h-[90vh] sm:rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">
                  Check-ins e Ações Manuais — {checkedIn.length}/{filtered.length}
                </h3>
                <button onClick={closeCheckinModal} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="border-b border-slate-100 px-5 py-3 space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input type="text" placeholder="Buscar por nome..." value={checkinSearch} onChange={(e) => setCheckinSearch(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {allBases.map(b => (
                    <button key={b} onClick={() => setCheckinFilterBase(checkinFilterBase === b ? null : b)}
                      className={`rounded-full px-2 py-1 font-medium transition-all cursor-pointer border ${checkinFilterBase === b ? "border-accent-300 bg-accent-50 text-accent-700 ring-1 ring-accent-200" : checkinFilterBase ? "border-slate-200 text-slate-400 opacity-50" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      {b}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {allFaculties.map(f => {
                    const fst = getFacultyStyle(f);
                    const active = checkinFilterFaculty === f;
                    return (
                      <button key={f} onClick={() => setCheckinFilterFaculty(active ? null : f)}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all cursor-pointer ${fst.pill} ${active ? "ring-2 ring-offset-1 scale-105" : checkinFilterFaculty ? "opacity-30" : ""}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />{f}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="max-h-[64vh] overflow-y-auto px-5 py-3 md:px-6">
                {filtered.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">Nenhum plantão neste período.</p>
                ) : (
                  <div className="space-y-4">
                    {/* Sem check-in section */}
                    {notCheckedIn.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <XCircle className="h-3.5 w-3.5 text-red-500" strokeWidth={1.5} />
                          <span className="text-xs font-semibold text-red-700 uppercase tracking-wider">Sem check-in — {notCheckedIn.length}</span>
                        </div>
                        {dayNotChecked.length > 0 && nightNotChecked.length > 0 ? (
                          <div className="space-y-3">
                            <div>
                              <div className="flex items-center gap-1 mb-1"><Sun className="h-3 w-3 text-amber-500" strokeWidth={1.5} /><span className="text-[10px] font-medium text-amber-600 uppercase">Diurno</span></div>
                              <ul className="divide-y divide-slate-100">{dayNotChecked.map(renderCheckinRow)}</ul>
                            </div>
                            <div>
                              <div className="flex items-center gap-1 mb-1"><Moon className="h-3 w-3 text-indigo-500" strokeWidth={1.5} /><span className="text-[10px] font-medium text-indigo-600 uppercase">Noturno</span></div>
                              <ul className="divide-y divide-slate-100">{nightNotChecked.map(renderCheckinRow)}</ul>
                            </div>
                          </div>
                        ) : (
                          <ul className="divide-y divide-slate-100">{notCheckedIn.map(renderCheckinRow)}</ul>
                        )}
                      </div>
                    )}
                    {/* Ausente section */}
                    {absent.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-red-600" strokeWidth={1.5} />
                          <span className="text-xs font-semibold text-red-800 uppercase tracking-wider">Ausente — {absent.length}</span>
                        </div>
                        <ul className="divide-y divide-slate-100">{absent.map(renderCheckinRow)}</ul>
                      </div>
                    )}
                    {/* Check-in feito section */}
                    {checkedIn.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.5} />
                          <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Check-in feito — {checkedIn.length}</span>
                        </div>
                        {dayChecked.length > 0 && nightChecked.length > 0 ? (
                          <div className="space-y-3">
                            <div>
                              <div className="flex items-center gap-1 mb-1"><Sun className="h-3 w-3 text-amber-500" strokeWidth={1.5} /><span className="text-[10px] font-medium text-amber-600 uppercase">Diurno</span></div>
                              <ul className="divide-y divide-slate-100">{dayChecked.map(renderCheckinRow)}</ul>
                            </div>
                            <div>
                              <div className="flex items-center gap-1 mb-1"><Moon className="h-3 w-3 text-indigo-500" strokeWidth={1.5} /><span className="text-[10px] font-medium text-indigo-600 uppercase">Noturno</span></div>
                              <ul className="divide-y divide-slate-100">{nightChecked.map(renderCheckinRow)}</ul>
                            </div>
                          </div>
                        ) : (
                          <ul className="divide-y divide-slate-100">{checkedIn.map(renderCheckinRow)}</ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Base Detail Modal */}
      {baseModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setBaseModal(null)}>
          <div className="relative mx-0 max-h-[85dvh] w-full max-w-xl overflow-hidden rounded-t-2xl sm:mx-4 sm:max-h-[75vh] sm:rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">{baseModal.title}</h3>
              <button onClick={() => setBaseModal(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
              {baseModal.items
                .sort((a, b) => (a.period === b.period ? a.internName.localeCompare(b.internName) : a.period === "DAY" ? -1 : 1))
                .map((item, i) => {
                  const fst = getFacultyStyle(item.faculty);
                  const STATUS_MAP: Record<string, string> = { SCHEDULED: "Escalado", CONFIRMED: "Confirmado", CHECKED_IN: "Presente", CHECKED_OUT: "Finalizado", ABSENT: "Ausente" };
                  const checkinTime = item.checkinAt ? formatBrazilTime(item.checkinAt) : null;
                  return (
                    <div key={i} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {item.period === "DAY"
                          ? <Sun className="h-3.5 w-3.5 text-amber-500 shrink-0" strokeWidth={1.5} />
                          : <Moon className="h-3.5 w-3.5 text-indigo-500 shrink-0" strokeWidth={1.5} />}
                        {item.internId ? (
                          <button
                            type="button"
                            onClick={() => setInternModal({ id: item.internId!, name: item.internName, faculty: item.faculty })}
                            className="truncate text-left text-sm font-medium text-slate-800 hover:text-accent-700 hover:underline"
                          >
                            {item.internName}
                          </button>
                        ) : (
                          <span className="text-sm font-medium text-slate-800 truncate">{item.internName}</span>
                        )}
                        {item.remanejado && (
                          <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                            Remanejado
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fst.pill}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                          {item.faculty}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0 ml-2">
                        {checkinTime && <span className="text-emerald-600">{checkinTime}</span>}
                        {item.validatedBy && <span className="text-slate-400 truncate max-w-[100px]" title={item.validatedBy}>✓ {item.validatedBy.split(" ")[0]}</span>}
                        <span className={item.status === "ABSENT" ? "text-red-600 font-medium" : "text-slate-400"}>{STATUS_MAP[item.status] ?? item.status}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Intern Quick Modal — opened by clicking an intern name in any KPI list */}
      {internModal && (
        <InternDrawer
          internId={internModal.id}
          internName={internModal.name}
          facultyAbbr={internModal.faculty}
          onClose={() => setInternModal(null)}
        />
      )}

      {/* Week Modal */}
      {weekModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setWeekModal(false)}>
          <div className="relative mx-0 max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl sm:mx-4 sm:max-h-none sm:rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Presença — Últimos 7 dias</h3>
              <button onClick={() => setWeekModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="text-center">
                <p className="text-3xl font-bold text-slate-900">{weekRate}%</p>
                <p className="text-xs text-slate-500">{weekPresent} de {weekTotal} plantões</p>
              </div>
              <div className="space-y-2">
                {weekDays.map((d) => {
                  const pct = d.total > 0 ? Math.round((d.present / d.total) * 100) : 0;
                  const dt = new Date(d.date + "T12:00:00");
                  const isToday = d.date === localDateStr();
                  return (
                    <div key={d.date} className={`rounded-lg px-3 py-2 ${isToday ? "bg-accent-50 ring-1 ring-accent-200" : ""}`}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className={`font-medium capitalize ${isToday ? "text-accent-700" : "text-slate-700"}`}>
                          {dt.getDate()}/{dt.getMonth() + 1}
                        </span>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-emerald-600 font-medium">{d.present}</span>
                          {d.absent > 0 && <span className="text-red-600 font-medium">{d.absent} falta(s)</span>}
                          <span className="text-slate-500">/ {d.total}</span>
                          <span className="font-semibold text-slate-700 w-8 text-right">{pct}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-100">
                        <div className={`h-full rounded-full transition-all ${d.absent > 0 ? "bg-red-400" : pct >= 80 ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {weekDays.length === 0 && <p className="py-4 text-center text-sm text-slate-400">Sem dados para esta semana.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Completed Modal */}
      {completedModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setCompletedModal(false)}>
          <div className="relative mx-0 max-h-[85dvh] w-full max-w-lg overflow-hidden rounded-t-2xl sm:mx-4 sm:max-h-[70vh] sm:rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Concluídos</h3>
              <button onClick={() => setCompletedModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex items-center justify-center gap-3 border-b border-slate-100 px-5 py-3">
              <button onClick={() => changeCompletedDate(-1)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium text-slate-700 min-w-[140px] text-center capitalize">
                {new Date(completedDate + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                {completedDate === localDateStr() && <span className="ml-1 text-accent-600">(hoje)</span>}
              </span>
              <button onClick={() => changeCompletedDate(1)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto px-5 py-3">
              {completedLoading ? (
                <p className="py-8 text-center text-sm text-slate-400">Carregando...</p>
              ) : completedRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">Nenhum plantão concluído neste dia.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {completedRows.map((r, i) => {
                    const fst = getFacultyStyle(r.faculty);
                    return (
                      <li key={i} className="flex items-center justify-between py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          {r.internId ? (
                            <button
                              type="button"
                              onClick={() => setInternModal({ id: r.internId!, name: r.name, faculty: r.faculty })}
                              className="truncate text-left text-sm font-medium text-slate-800 hover:text-accent-700 hover:underline"
                            >
                              {r.name}
                            </button>
                          ) : (
                            <span className="text-sm font-medium text-slate-800 truncate">{r.name}</span>
                          )}
                          {r.faculty && (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fst.pill}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                              {r.faculty}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-slate-500 shrink-0 ml-2">{r.extra}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
