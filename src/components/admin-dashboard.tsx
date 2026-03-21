"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Users, Calendar, CalendarDays, CheckCircle, Activity, XCircle, AlertTriangle, Building2, GraduationCap, X, Search, Sun, Moon, UserPlus, TrendingUp, ChevronLeft, ChevronRight } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { InviteButton } from "@/components/invite-button";
import { getFacultyStyle, baseViewIndex } from "@/lib/base-colors";

type DetailRow = {
  name: string;
  faculty: string;
  extra: string;
};

type FacultyRow = { abbreviation: string; total: number; present: number; absent: number; pending: number };
type BaseRow = { code: string; name: string; total: number; present: number; absent: number };

type BaseDetailItem = {
  internName: string;
  faculty: string;
  period: string;
  status: string;
  checkinAt: string | null;
  validatedBy: string | null;
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
  weekRate: number;
  weekDays: WeekDay[];
  faculties: FacultyRow[];
  bases: BaseRow[];
  baseDetails: Record<string, BaseDetailItem[]>;
  dateLabel: string;
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

export function AdminDashboardClient({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalData>(null);
  const [baseModal, setBaseModal] = useState<BaseModalData>(null);
  const [weekModal, setWeekModal] = useState(false);
  const [completedModal, setCompletedModal] = useState(false);
  const [completedDate, setCompletedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [completedRows, setCompletedRows] = useState<DetailRow[]>([]);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [search, setSearch] = useState("");
  const { s, checkinRate, weekRate, weekDays, faculties, bases, baseDetails, dateLabel, details } = data;
  const incidents = (s["geo_violations"] ?? 0) + (s["totp_expired"] ?? 0);

  function openModal(title: string, rows: DetailRow[]) {
    setModal({ title, rows });
  }

  function openBase(b: BaseRow) {
    const items = baseDetails[b.code] ?? [];
    if (items.length > 0) setBaseModal({ title: `${b.code} — ${b.name}`, items });
  }

  const fetchCompleted = useCallback(async (dateStr: string) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (dateStr === todayStr) { setCompletedRows(data.details.todayCompleted); return; }
    setCompletedLoading(true);
    try {
      const res = await fetch(`/taximetro/api/assignments?from=${dateStr}&to=${dateStr}`);
      const json = await res.json();
      if (json.success) {
        type Row = { internName: string; facultyAbbr: string; baseCode: string; period: string; status: string };
        setCompletedRows((json.data as Row[])
          .filter((a) => a.status === "CHECKED_OUT")
          .sort((a, b) => baseViewIndex(a.baseCode) - baseViewIndex(b.baseCode))
          .map((a) => ({ name: a.internName, faculty: a.facultyAbbr ?? "", extra: `${a.baseCode} — ${PERIOD_LABEL[a.period] ?? a.period}` })));
      }
    } catch { /* keep current */ }
    setCompletedLoading(false);
  }, [data.details.todayCompleted]);

  function openCompleted() {
    setCompletedDate(new Date().toISOString().slice(0, 10));
    setCompletedRows(data.details.todayCompleted);
    setCompletedModal(true);
  }

  function changeCompletedDate(delta: number) {
    const d = new Date(completedDate + "T12:00:00");
    d.setDate(d.getDate() + delta);
    const todayStr = new Date().toISOString().slice(0, 10);
    const sevenAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const nd = d.toISOString().slice(0, 10);
    if (nd > todayStr || nd < sevenAgo) return;
    setCompletedDate(nd);
    fetchCompleted(nd);
  }

  return (
    <div className="space-y-6 animate-[fadeInUp_200ms_ease-out]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="mt-1 flex items-center gap-3 text-sm text-slate-500">
            <span className="capitalize">{dateLabel}</span>
            <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" strokeWidth={1.5} />{s["base_count"] ?? 0} bases</span>
            <span className="flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" strokeWidth={1.5} />{s["faculty_count"] ?? 0} faculdades</span>
          </p>
        </div>
        <InviteButton />
      </div>

      {/* KPI — Operação */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Operação</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MetricCard label="Plantões hoje" value={s["today_assignments"] ?? 0} icon={Calendar}
            className="cursor-pointer" onClick={() => openModal("Plantões Hoje", details.todayAssignments)} />
          <MetricCard label="Presença semana" value={`${weekRate}%`} icon={CalendarDays}
            severity={weekRate >= 80 ? "success" : weekRate >= 50 ? "default" : "warning"}
            sub={`${s["week_present"] ?? 0} de ${s["week_scheduled"] ?? 0}`}
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
            sub={`${s["today_checkins"] ?? 0} de ${s["today_assignments"] ?? 0}`}
            className="cursor-pointer" onClick={() => openModal("Check-ins Hoje", details.checkedIn)} />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setModal(null); setSearch(""); }}>
          <div className="relative mx-4 max-h-[70vh] w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
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
                    return (
                    <li key={i} className="flex items-center justify-between py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-slate-800 truncate">{r.name}</span>
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

      {/* Base Detail Modal */}
      {baseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setBaseModal(null)}>
          <div className="relative mx-4 max-h-[75vh] w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
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
                  const checkinTime = item.checkinAt ? new Date(item.checkinAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;
                  return (
                    <div key={i} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {item.period === "DAY"
                          ? <Sun className="h-3.5 w-3.5 text-amber-500 shrink-0" strokeWidth={1.5} />
                          : <Moon className="h-3.5 w-3.5 text-indigo-500 shrink-0" strokeWidth={1.5} />}
                        <span className="text-sm font-medium text-slate-800 truncate">{item.internName}</span>
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

      {/* Week Modal */}
      {weekModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setWeekModal(false)}>
          <div className="relative mx-4 w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Presença — Últimos 7 dias</h3>
              <button onClick={() => setWeekModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="text-center">
                <p className="text-3xl font-bold text-slate-900">{weekRate}%</p>
                <p className="text-xs text-slate-500">{s["week_present"] ?? 0} de {s["week_scheduled"] ?? 0} plantões realizados</p>
              </div>
              <div className="space-y-2">
                {weekDays.map((d) => {
                  const pct = d.total > 0 ? Math.round((d.present / d.total) * 100) : 0;
                  const dt = new Date(d.date + "T12:00:00");
                  const isToday = d.date === new Date().toISOString().slice(0, 10);
                  return (
                    <div key={d.date} className={`rounded-lg px-3 py-2 ${isToday ? "bg-accent-50 ring-1 ring-accent-200" : ""}`}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className={`font-medium capitalize ${isToday ? "text-accent-700" : "text-slate-700"}`}>
                          {dt.toLocaleDateString("pt-BR", { weekday: "short" })} {dt.getDate()}/{dt.getMonth() + 1}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCompletedModal(false)}>
          <div className="relative mx-4 max-h-[70vh] w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
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
                {new Date(completedDate + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}
                {completedDate === new Date().toISOString().slice(0, 10) && <span className="ml-1 text-accent-600">(hoje)</span>}
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
                          <span className="text-sm font-medium text-slate-800 truncate">{r.name}</span>
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
