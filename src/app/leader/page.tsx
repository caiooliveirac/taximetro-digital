"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Users, Calendar, CheckCircle, Clock, XCircle, RefreshCw,
  AlertTriangle, AlertCircle, Target, ChevronDown, ChevronUp, ArrowRight, MapPinOff, MapPin, Sun, Moon, Stethoscope, Loader2,
} from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { TableSkeleton } from "@/components/table-skeleton";
import { getFacultyStyle } from "@/lib/base-colors";
import { addDaysToDateStr, isCurrentOperationalAssignment, operationalDateStr } from "@/lib/utils";

type Stats = {
  totalInterns: number;
  scheduledThisWeek: number;
  pendingRequests: number;
  confirmedToday: number;
  absentToday: number;
  checkedInToday: number;
};

type ComplianceRow = {
  userId: string;
  name: string;
  facultyAbbr: string;
  targetShifts: number;
  targetShiftsPerWeek: number;
  totalCompleted: number;
  totalDeficit: number;
  totalPct: number | null;
  thisWeekScheduled: number;
  thisWeekCompleted: number;
  thisWeekAbsent: number;
  lastWeekCompleted: number;
  weeklyDeficit: number;
  belowWeeklyTarget: boolean;
  futureScheduled: number;
  rawDeficit: number;
  netDeficit: number;
  status: "ok" | "compensating" | "partial" | "deficit";
};

type ComplianceSummary = {
  totalInterns: number;
  belowWeeklyTarget: number;
  belowTotalTarget: number;
  compensating: number;
};

type Alert = {
  type: string;
  intern_name: string;
  faculty: string;
  base_code: string;
  period: string;
  date: string;
  detail: string | null;
};

type Incident = {
  internName: string;
  baseCode: string;
  period: string;
  reason: string;
};

type WeeklyCategory = "com_falta" | "sub_alocado" | "na_meta";

function categorize(c: ComplianceRow): WeeklyCategory {
  if (c.thisWeekAbsent > 0) return "com_falta";
  const effective = c.thisWeekScheduled - c.thisWeekAbsent;
  if (c.targetShiftsPerWeek > 0 && effective < c.targetShiftsPerWeek) return "sub_alocado";
  return "na_meta";
}

const CATEGORY_CONFIG: Record<WeeklyCategory, { label: string; border: string; bg: string; text: string; icon: typeof XCircle }> = {
  com_falta: { label: "Com falta", border: "border-red-200", bg: "bg-red-50/50", text: "text-red-700", icon: XCircle },
  sub_alocado: { label: "Sub-alocados", border: "border-amber-200", bg: "bg-amber-50/50", text: "text-amber-700", icon: AlertTriangle },
  na_meta: { label: "Na meta", border: "border-emerald-200", bg: "bg-emerald-50/30", text: "text-emerald-700", icon: CheckCircle },
};

export default function LeaderDashboard() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [stats, setStats] = useState<Stats>({ totalInterns: 0, scheduledThisWeek: 0, pendingRequests: 0, confirmedToday: 0, absentToday: 0, checkedInToday: 0 });
  const [compliance, setCompliance] = useState<ComplianceRow[]>([]);
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroup, setExpandedGroup] = useState<WeeklyCategory | null>(null);
  const [error, setError] = useState("");
  const [myAssignment, setMyAssignment] = useState<{ id: string; baseCode: string; baseName: string; period: string; status: string } | null>(null);
  const [preceptorRedirecting, setPreceptorRedirecting] = useState(false);
  const [preceptorAccessError, setPreceptorAccessError] = useState("");
  const sessionRoles = session?.user?.roles ?? (session?.user?.role ? [session.user.role] : []);
  const canActAsPreceptor = sessionRoles.includes("PRECEPTOR");

  function handleOpenPreceptorView() {
    if (status !== "authenticated") {
      setPreceptorAccessError("Sessão indisponível. Entre novamente para abrir a visão de preceptoria.");
      return;
    }

    if (!canActAsPreceptor) {
      setPreceptorAccessError("Seu login atual ainda não trouxe a role de preceptoria. Saia e entre novamente.");
      return;
    }

    setPreceptorAccessError("");
    setPreceptorRedirecting(true);
    router.push("/preceptor");
  }

  useEffect(() => {
    async function load() {
      try {
        const today = operationalDateStr();
        const weekEnd = addDaysToDateStr(today, 7);

        const [usersRes, assignmentsRes, requestsRes, todayRes, complianceRes, alertsRes] = await Promise.all([
          fetch("/taximetro/api/admin/users"),
          fetch(`/taximetro/api/assignments?from=${today}&to=${weekEnd}`),
          fetch("/taximetro/api/requests"),
          fetch(`/taximetro/api/assignments?from=${today}&to=${today}`),
          fetch("/taximetro/api/compliance"),
          fetch("/taximetro/api/admin/alerts").catch(() => null),
        ]);

        // Fetch leader's own assignment for today
        const myRes = await fetch(`/taximetro/api/assignments?from=${today}&to=${today}&selfOnly=true`);
        const myJson = await myRes.json();
        if (myJson.success && myJson.data.length > 0) {
          const active = myJson.data.find((a: { status: string; date: string; period: string }) => a.status !== "CANCELLED" && isCurrentOperationalAssignment(a.date, a.period as "DAY" | "NIGHT"))
            ?? myJson.data.find((a: { status: string }) => a.status !== "CANCELLED");
          setMyAssignment(active ?? null);
        } else {
          setMyAssignment(null);
        }

        const [usersJson, assignmentsJson, requestsJson, todayJson, complianceJson] = await Promise.all([
          usersRes.json(), assignmentsRes.json(), requestsRes.json(), todayRes.json(), complianceRes.json(),
        ]);

        const alertsJson = alertsRes ? await alertsRes.json().catch(() => ({ data: [] })) : { data: [] };

        const todayActive = todayJson.success ? todayJson.data.filter((a: { status: string }) => a.status !== "CANCELLED") : [];

        setStats({
          totalInterns: usersJson.success ? usersJson.data.filter((u: { role: string }) => u.role === "INTERN").length : 0,
          scheduledThisWeek: assignmentsJson.success ? assignmentsJson.data.filter((a: { status: string }) => a.status !== "CANCELLED").length : 0,
          pendingRequests: requestsJson.success ? requestsJson.data.filter((r: { status: string }) => r.status === "PENDING").length : 0,
          confirmedToday: todayActive.filter((a: { status: string }) => ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(a.status)).length,
          absentToday: todayActive.filter((a: { status: string }) => a.status === "ABSENT").length,
          checkedInToday: todayActive.filter((a: { status: string }) => a.status === "CHECKED_IN").length,
        });

        if (complianceJson.success) {
          setCompliance(complianceJson.data ?? []);
          setSummary(complianceJson.summary ?? null);
        }

        if (alertsJson.data) setAlerts(alertsJson.data.slice(0, 5));

        // Compute check-in irregularities from today's assignments
        type TodayRow = { internName: string; baseCode: string; period: string; status: string; checkinGeoValid: boolean | null; checkinStatus: string | null };
        const todayAll: TodayRow[] = todayJson.success ? todayJson.data : [];
        const irregulars: Incident[] = [];
        for (const a of todayAll) {
          if (a.checkinGeoValid === false) {
            irregulars.push({ internName: a.internName, baseCode: a.baseCode, period: a.period, reason: "Check-in fora do georreferenciamento" });
          } else if (a.checkinStatus === "EXPIRED") {
            irregulars.push({ internName: a.internName, baseCode: a.baseCode, period: a.period, reason: "TOTP expirado — sem validação" });
          }
        }
        setIncidents(irregulars);
        setError("");
      } catch {
        setError("Erro ao carregar dashboard. Tente recarregar a página.");
      }
      setLoading(false);
    }
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, []);

  if (loading) return <TableSkeleton rows={4} cols={5} />;
  if (error) return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;

  // Group compliance by weekly category
  const groups: Record<WeeklyCategory, ComplianceRow[]> = { com_falta: [], sub_alocado: [], na_meta: [] };
  for (const c of compliance) {
    groups[categorize(c)].push(c);
  }

  // Auto-expand first non-empty alert group
  const autoExpand = expandedGroup ?? (groups.com_falta.length > 0 ? "com_falta" : groups.sub_alocado.length > 0 ? "sub_alocado" : null);

  return (
    <div className="space-y-6 animate-[fadeInUp_200ms_ease-out]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <span className="flex items-center gap-1 text-xs text-slate-400">
          <RefreshCw className="h-3 w-3" strokeWidth={1.5} /> 30s
        </span>
      </div>

      {canActAsPreceptor && (
        <div className="rounded-2xl border border-emerald-200 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(13,148,136,0.18))] p-5 shadow-[0_14px_28px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Acesso de Função</p>
              <h2 className="text-lg font-semibold text-slate-900">Entrar como preceptora</h2>
              <p className="text-sm text-slate-600">Use este atalho para validar a sua auth atual e abrir diretamente a tela de validação de check-in.</p>
            </div>
            <button
              type="button"
              onClick={handleOpenPreceptorView}
              disabled={preceptorRedirecting}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(5,150,105,0.24)] transition hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-70"
            >
              {preceptorRedirecting ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> : <Stethoscope className="h-4 w-4" strokeWidth={1.8} />}
              Abrir visão de preceptoria
            </button>
          </div>
          {preceptorAccessError && <p className="mt-3 text-sm text-amber-700">{preceptorAccessError}</p>}
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Internos" value={stats.totalInterns} icon={Users} />
        <MetricCard label="Presentes hoje" value={stats.checkedInToday} icon={CheckCircle} severity="success" />
        <MetricCard label="Faltas hoje" value={stats.absentToday} icon={XCircle} severity={stats.absentToday > 0 ? "danger" : "default"} />
        <MetricCard label="Solicitações" value={stats.pendingRequests} icon={Clock} severity={stats.pendingRequests > 0 ? "warning" : "default"} />
      </div>

      {/* Leader's own shift */}
      {myAssignment && (myAssignment.status === "SCHEDULED" || myAssignment.status === "CONFIRMED") && (
        <Link href="/intern/checkin" className="block">
          <div className="rounded-xl border border-accent-200 bg-accent-50/50 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:bg-accent-50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MapPin className="h-5 w-5 text-accent-600" strokeWidth={1.5} />
                <div>
                  <p className="text-sm font-semibold text-accent-900">Meu plantão hoje</p>
                  <p className="text-xs text-accent-700">{myAssignment.baseCode} — {myAssignment.baseName} · {myAssignment.period === "DAY" ? "Diurno" : "Noturno"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-medium text-white">
                Fazer check-in <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </div>
            </div>
          </div>
        </Link>
      )}
      {myAssignment && myAssignment.status === "CHECKED_IN" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-emerald-600" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-semibold text-emerald-900">Check-in realizado</p>
              <p className="text-xs text-emerald-700">{myAssignment.baseCode} — {myAssignment.baseName} · {myAssignment.period === "DAY" ? "Diurno" : "Noturno"}</p>
            </div>
          </div>
        </div>
      )}

      {/* Check-in irregular */}
      {incidents.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-2 mb-3">
            <MapPinOff className="h-4 w-4 text-amber-600" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-amber-900">Check-in irregular hoje</h2>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{incidents.length}</span>
          </div>
          <div className="space-y-1">
            {incidents.map((inc, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2.5 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-slate-900 truncate">{inc.internName}</span>
                  <span className="text-xs text-slate-500 shrink-0">{inc.baseCode} — {inc.period === "DAY" ? "Diurno" : "Noturno"}</span>
                </div>
                <span className="text-xs font-medium text-amber-700 shrink-0 ml-2">{inc.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly goal tracking */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Meta Semanal</h2>
          <div className="flex items-center gap-2">
            {(["com_falta", "sub_alocado", "na_meta"] as const).map((cat) => {
              const cfg = CATEGORY_CONFIG[cat];
              const count = groups[cat].length;
              if (count === 0) return null;
              return (
                <span key={cat} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                  {count} {cfg.label.toLowerCase()}
                </span>
              );
            })}
          </div>
        </div>

        {/* Alert groups — com_falta and sub_alocado always visible, na_meta collapsed */}
        {(["com_falta", "sub_alocado", "na_meta"] as const).map((cat) => {
          const rows = groups[cat];
          if (rows.length === 0) return null;
          const cfg = CATEGORY_CONFIG[cat];
          const CatIcon = cfg.icon;
          const isExpanded = autoExpand === cat || expandedGroup === cat;
          const isAlert = cat !== "na_meta";

          return (
            <div key={cat} className={`rounded-xl border ${cfg.border} ${isAlert ? cfg.bg : "bg-white"} shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden`}>
              <button
                onClick={() => setExpandedGroup(expandedGroup === cat ? null : cat)}
                className="flex w-full items-center justify-between px-5 py-3 text-left"
              >
                <div className="flex items-center gap-2">
                  <CatIcon className={`h-4 w-4 ${cfg.text}`} strokeWidth={1.5} />
                  <span className={`text-sm font-semibold ${isAlert ? cfg.text.replace("700", "900") : "text-slate-900"}`}>
                    {cfg.label}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                    {rows.length}
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                ) : (
                  <ChevronDown className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                )}
              </button>

              {isExpanded && (
                <div className="border-t border-inherit px-2 pb-2">
                  {rows.map((c) => {
                    const fs = getFacultyStyle(c.facultyAbbr);
                    const effective = c.thisWeekScheduled - c.thisWeekAbsent;
                    return (
                      <div
                        key={c.userId}
                        className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2.5 mt-1 first:mt-0 text-sm hover:bg-white transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-slate-900 truncate">{c.name}</span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${fs.pill}`}>
                            {c.facultyAbbr}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-xs">
                          <span className={`font-medium tabular-nums ${effective >= c.targetShiftsPerWeek ? "text-emerald-600" : "text-red-600"}`}>
                            {effective}/{c.targetShiftsPerWeek}
                          </span>
                          {c.thisWeekAbsent > 0 && (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700 font-medium">
                              {c.thisWeekAbsent} falta{c.thisWeekAbsent > 1 ? "s" : ""}
                            </span>
                          )}
                          {cat === "sub_alocado" && (
                            <Link
                              href="/leader/escala"
                              className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-2 py-1 text-accent-700 font-medium hover:bg-accent-100 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Alocar <ArrowRight className="h-3 w-3" strokeWidth={2} />
                            </Link>
                          )}
                          {cat === "com_falta" && (
                            <Link
                              href="/leader/escala"
                              className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 text-red-700 font-medium hover:bg-red-200 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Repor <ArrowRight className="h-3 w-3" strokeWidth={2} />
                            </Link>
                          )}
                          {c.rawDeficit > 0 && cat === "na_meta" && (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700 font-medium">
                              Compensando
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {isAlert && (
                    <div className="mt-2 px-3 pb-1">
                      <Link
                        href="/leader/escala"
                        className="text-xs font-medium text-accent-600 hover:text-accent-700 transition-colors"
                      >
                        Abrir escala para alocar →
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Compensation tracking — only if there are interns with global deficit */}
      {compliance.filter((c) => c.rawDeficit > 0).length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-4 w-4 text-slate-600" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-900">Reposição Global</h2>
          </div>
          <div className="space-y-2">
            {compliance.filter((c) => c.rawDeficit > 0).map((c) => {
              const fs = getFacultyStyle(c.facultyAbbr);
              return (
                <div key={c.userId} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{c.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${fs.pill}`}>{c.facultyAbbr}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 w-24">
                      <div className="h-2 flex-1 rounded-full bg-slate-100">
                        <div
                          className={`h-2 rounded-full transition-all ${(c.totalPct ?? 0) >= 100 ? "bg-emerald-500" : (c.totalPct ?? 0) >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                          style={{ width: `${c.totalPct ?? 0}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500 tabular-nums">{c.totalPct ?? 0}%</span>
                    </div>
                    {c.status === "compensating" ? (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 font-medium">Compensando (+{c.futureScheduled})</span>
                    ) : c.status === "partial" ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 font-medium">Faltam {c.netDeficit}</span>
                    ) : (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700 font-medium">Déficit {c.rawDeficit}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">Alertas Recentes</h2>
          {alerts.map((a, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 rounded-lg border-l-3 px-4 py-2.5 text-sm ${a.type === "ABSENCE"
                ? "border-red-500 bg-red-50 text-red-700"
                : "border-amber-500 bg-amber-50 text-amber-700"
                }`}
            >
              {a.type === "ABSENCE" ? (
                <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              )}
              <span>{a.intern_name} — {a.base_code} ({a.date})</span>
              {a.detail && <span className="text-xs opacity-70">[{a.detail}]</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
