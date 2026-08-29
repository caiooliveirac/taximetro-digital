"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Users, Calendar, CheckCircle, Clock, XCircle, RefreshCw,
  AlertTriangle, AlertCircle, Target, ChevronDown, ChevronUp, ArrowRight, MapPinOff, MapPin, Sun, Moon, Stethoscope, Loader2, Archive,
} from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { TableSkeleton } from "@/components/table-skeleton";
import { getFacultyStyle } from "@/lib/base-colors";
import { addDaysToDateStr, getBrazilNowParts, isCurrentOperationalAssignment, localDateStr, startOfWeekDateStr, weeksBetweenDateStr } from "@/lib/utils";
import { sessionHasRole } from "@/lib/roles";
import { isFutureShiftRequest, type RequestShiftRow } from "@/features/requests/domain/request-shift-window";

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
  rotationStartDate: string;
  targetShifts: number;
  targetShiftsPerWeek: number;
  targetUSAPerWeek: number;
  targetUSATotal: number;
  targetCRUPerWeek: number;
  targetCRUTotal: number;
  targetCRLPerWeek: number;
  totalCompleted: number;
  totalDeficit: number;
  totalPct: number | null;
  thisWeekScheduled: number;
  thisWeekCompleted: number;
  thisWeekAbsent: number;
  lastWeekCompleted: number;
  lastWeekUSACompleted: number;
  lastWeekCRUCompleted: number;
  lastWeekCRLCompleted: number;
  weeklyUSADeficit: number;
  weeklyCRUDeficit: number;
  weeklyCRLDeficit: number;
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

type WeekAssignment = {
  id: string;
  internId: string;
  internName: string;
  baseCode: string;
  baseName?: string;
  baseType: string;
  date: string;
  period: "DAY" | "NIGHT";
  status: string;
  isExtraShift?: boolean;
  absenceJustification?: string | null;
  absenceJustificationActor?: string | null;
  absenceJustificationAt?: string | null;
};

type WeeklyCategory = "com_falta" | "sub_alocado" | "na_meta";

const CATEGORY_CONFIG: Record<WeeklyCategory, { label: string; border: string; bg: string; text: string; icon: typeof XCircle }> = {
  com_falta: { label: "Com falta", border: "border-red-200", bg: "bg-red-50/50", text: "text-red-700", icon: XCircle },
  sub_alocado: { label: "Sub-alocados", border: "border-amber-200", bg: "bg-amber-50/50", text: "text-amber-700", icon: AlertTriangle },
  na_meta: { label: "Na meta", border: "border-emerald-200", bg: "bg-emerald-50/30", text: "text-emerald-700", icon: CheckCircle },
};

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
const CHECKIN_DONE = new Set(["CHECKED_IN", "CHECKED_OUT"]);
const COMPLETED_STATUSES = new Set(["CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "EXCUSED"]);
const PROJECTABLE_FUTURE_STATUSES = new Set(["SCHEDULED", "CONFIRMED"]);

function dayLabel(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return DAY_LABELS[d.getUTCDay()] ?? "";
}

function periodEmoji(period: "DAY" | "NIGHT") {
  return period === "DAY" ? "☀️" : "🌙";
}

function normalizeDate(date: string) {
  return date.slice(0, 10);
}

function shortDate(date: string) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export default function LeaderDashboard() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [stats, setStats] = useState<Stats>({ totalInterns: 0, scheduledThisWeek: 0, pendingRequests: 0, confirmedToday: 0, absentToday: 0, checkedInToday: 0 });
  const [weekAssignments, setWeekAssignments] = useState<WeekAssignment[]>([]);
  const [monitorAssignments, setMonitorAssignments] = useState<WeekAssignment[]>([]);
  const [compliance, setCompliance] = useState<ComplianceRow[]>([]);
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroup, setExpandedGroup] = useState<WeeklyCategory | null>(null);
  const [expandedPendingInternId, setExpandedPendingInternId] = useState<string | null>(null);
  const [archivedInternIds, setArchivedInternIds] = useState<Set<string>>(new Set());
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archivingAll, setArchivingAll] = useState(false);
  const [error, setError] = useState("");
  const [myAssignment, setMyAssignment] = useState<{ id: string; baseCode: string; baseName: string; period: string; status: string } | null>(null);
  const [preceptorRedirecting, setPreceptorRedirecting] = useState(false);
  const [preceptorAccessError, setPreceptorAccessError] = useState("");
  async function handleArchiveIntern(internId: string) {
    setArchivingId(internId);
    try {
      const res = await fetch("/taximetro/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: internId, isArchived: true }),
      });
      const json = await res.json();
      if (json.success) {
        setCompliance((prev) => prev.filter((r) => r.userId !== internId));
        setArchivedInternIds((prev) => new Set([...prev, internId]));
      }
    } finally {
      setArchivingId(null);
    }
  }

  async function handleArchiveAllCandidates(candidates: typeof compliance) {
    setArchivingAll(true);
    try {
      await Promise.all(
        candidates.map((row) =>
          fetch("/taximetro/api/admin/users", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: row.userId, isArchived: true }),
          }),
        ),
      );
      const ids = candidates.map((r) => r.userId);
      setCompliance((prev) => prev.filter((r) => !ids.includes(r.userId)));
      setArchivedInternIds((prev) => new Set([...prev, ...ids]));
    } finally {
      setArchivingAll(false);
    }
  }

  const canActAsPreceptor = sessionHasRole(session, "PRECEPTOR");

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
        const today = localDateStr();
        const weekStart = startOfWeekDateStr(today);
        const weekEnd = addDaysToDateStr(weekStart, 6);
        const monitorStart = addDaysToDateStr(weekStart, -365);
        const monitorEnd = addDaysToDateStr(weekEnd, 120);

        const [usersRes, assignmentsRes, monitorAssignmentsRes, requestsRes, todayRes, complianceRes, alertsRes] = await Promise.all([
          fetch("/taximetro/api/admin/users"),
          fetch(`/taximetro/api/assignments?from=${weekStart}&to=${weekEnd}`),
          fetch(`/taximetro/api/assignments?from=${monitorStart}&to=${monitorEnd}`),
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

        const [usersJson, assignmentsJson, monitorAssignmentsJson, requestsJson, todayJson, complianceJson] = await Promise.all([
          usersRes.json(), assignmentsRes.json(), monitorAssignmentsRes.json(), requestsRes.json(), todayRes.json(), complianceRes.json(),
        ]);

        if (assignmentsJson.success) {
          setWeekAssignments(
            assignmentsJson.data
              .filter((a: WeekAssignment) => a.status !== "CANCELLED")
              .map((a: WeekAssignment) => ({
                ...a,
                date: normalizeDate(a.date),
                period: a.period === "NIGHT" ? "NIGHT" : "DAY",
              })),
          );
        } else {
          setWeekAssignments([]);
        }

        if (monitorAssignmentsJson.success) {
          setMonitorAssignments(
            monitorAssignmentsJson.data
              .filter((a: WeekAssignment) => a.status !== "CANCELLED")
              .map((a: WeekAssignment) => ({
                ...a,
                date: normalizeDate(a.date),
                period: a.period === "NIGHT" ? "NIGHT" : "DAY",
              })),
          );
        } else {
          setMonitorAssignments([]);
        }

        const alertsJson = alertsRes ? await alertsRes.json().catch(() => ({ data: [] })) : { data: [] };

        const todayActive = todayJson.success ? todayJson.data.filter((a: { status: string }) => a.status !== "CANCELLED") : [];

        setStats({
          totalInterns: usersJson.success ? usersJson.data.filter((u: { role: string }) => u.role === "INTERN").length : 0,
          scheduledThisWeek: assignmentsJson.success ? assignmentsJson.data.filter((a: { status: string }) => a.status !== "CANCELLED").length : 0,
          // Mesma régua da tela de solicitações: plantão que já começou não
          // é mais pendência do líder.
          pendingRequests: requestsJson.success
            ? (requestsJson.data as Array<RequestShiftRow & { status: string }>)
              .filter((r) => r.status === "PENDING" && isFutureShiftRequest(r)).length
            : 0,
          confirmedToday: todayActive.filter((a: { status: string }) => ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(a.status)).length,
          absentToday: todayActive.filter((a: { status: string }) => a.status === "ABSENT").length,
          checkedInToday: todayActive.filter((a: { status: string }) => a.status === "CHECKED_IN").length,
        });

        if (complianceJson.success) {
          setCompliance(complianceJson.data ?? []);
          setSummary(complianceJson.summary ?? null);
        }

        if (usersJson.success) {
          const archived = new Set<string>(
            (usersJson.data as Array<{ id: string; role: string; isArchived: boolean; isActive: boolean }>)
              .filter((u) => u.role === "INTERN" && u.isActive && u.isArchived)
              .map((u) => u.id),
          );
          setArchivedInternIds(archived);
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

  const today = localDateStr();
  const nowHour = getBrazilNowParts().hour;

  const weeklyAssignmentsByIntern = new Map<string, WeekAssignment[]>();
  const monitorAssignmentsByIntern = new Map<string, WeekAssignment[]>();
  for (const assignment of weekAssignments) {
    if (!weeklyAssignmentsByIntern.has(assignment.internId)) {
      weeklyAssignmentsByIntern.set(assignment.internId, []);
    }
    weeklyAssignmentsByIntern.get(assignment.internId)!.push(assignment);
  }
  for (const assignment of monitorAssignments) {
    if (!monitorAssignmentsByIntern.has(assignment.internId)) {
      monitorAssignmentsByIntern.set(assignment.internId, []);
    }
    monitorAssignmentsByIntern.get(assignment.internId)!.push(assignment);
  }

  const weeklyTruthByIntern = new Map<string, {
    usaCount: number;
    cruCount: number;
    crlCount: number;
    eligibleScheduled: number;
    eligibleAbsent: number;
  }>();
  for (const row of compliance) {
    weeklyTruthByIntern.set(row.userId, {
      usaCount: 0,
      cruCount: 0,
      crlCount: 0,
      eligibleScheduled: 0,
      eligibleAbsent: 0,
    });
  }
  for (const assignment of weekAssignments) {
    if (!weeklyTruthByIntern.has(assignment.internId)) {
      weeklyTruthByIntern.set(assignment.internId, {
        usaCount: 0,
        cruCount: 0,
        crlCount: 0,
        eligibleScheduled: 0,
        eligibleAbsent: 0,
      });
    }
    const truth = weeklyTruthByIntern.get(assignment.internId)!;
    if (assignment.baseType === "USA") truth.usaCount += 1;
    if (assignment.baseType === "CENTRAL") truth.cruCount += 1;
    if (assignment.baseType === "CRL") truth.crlCount += 1;
    if (assignment.baseType === "USA" || assignment.baseType === "CENTRAL") {
      truth.eligibleScheduled += 1;
      if (assignment.status === "ABSENT") truth.eligibleAbsent += 1;
    }
  }

  function weeklyCategory(c: ComplianceRow): WeeklyCategory {
    const truth = weeklyTruthByIntern.get(c.userId) ?? {
      usaCount: 0,
      cruCount: 0,
      crlCount: 0,
      eligibleScheduled: 0,
      eligibleAbsent: 0,
    };
    if (truth.eligibleAbsent > 0) return "com_falta";
    const effective = truth.eligibleScheduled - truth.eligibleAbsent;
    if (c.targetShiftsPerWeek > 0 && effective < c.targetShiftsPerWeek) return "sub_alocado";
    return "na_meta";
  }

  // Group compliance by weekly category using schedule truth (same source as escala)
  const groups: Record<WeeklyCategory, ComplianceRow[]> = { com_falta: [], sub_alocado: [], na_meta: [] };
  for (const c of compliance) {
    groups[weeklyCategory(c)].push(c);
  }

  const twentyOneDaysAgo = addDaysToDateStr(today, -21);

  const archiveCandidates = compliance.filter((row) => {
    const internAssignments = monitorAssignmentsByIntern.get(row.userId) ?? [];
    return !internAssignments.some((a) => a.date >= twentyOneDaysAgo);
  });

  const pendingAttendance = monitorAssignments
    .filter((assignment) => {
      if (archivedInternIds.has(assignment.internId)) return false;
      if (assignment.isExtraShift) return false;
      if (CHECKIN_DONE.has(assignment.status)) return false;
      if (assignment.status === "ABSENT" || assignment.status === "CANCELLED") return false;
      if (assignment.date < today) return true;
      if (assignment.date > today) return false;
      if (assignment.period === "DAY") return nowHour >= 7;
      return nowHour >= 19;
    })
    .sort((left, right) => {
      if (left.date !== right.date) return left.date < right.date ? -1 : 1;
      if (left.period !== right.period) return left.period === "DAY" ? -1 : 1;
      return left.baseCode.localeCompare(right.baseCode);
    });

  const pendingByIntern = new Map<string, {
    internId: string;
    name: string;
    facultyAbbr: string;
    cruDebt: number;
    usaDebt: number;
    crlDebt: number;
    targetShifts: number;
    totalCompleted: number;
    unresolvedAbsence: number;
    attendance: WeekAssignment[];
  }>();

  for (const row of compliance) {
    const personAllRows = (monitorAssignmentsByIntern.get(row.userId) ?? []).filter((assignment) => assignment.status !== "CANCELLED");
    const rotationStart = row.rotationStartDate || startOfWeekDateStr(today);
    const relevantRows = personAllRows.filter((assignment) => assignment.date >= rotationStart);
    const currentWeekStart = startOfWeekDateStr(today);
    const rotationWeekStart = startOfWeekDateStr(rotationStart);
    const elapsedWeeksIncludingCurrent = weeksBetweenDateStr(rotationWeekStart, currentWeekStart) + 1;
    const elapsedPastWeeks = Math.max(0, elapsedWeeksIncludingCurrent - 1);

    const usaTotalTarget = row.targetUSATotal > 0
      ? row.targetUSATotal
      : Math.max(0, (row.targetUSAPerWeek ?? 0) * 5);
    const usaExpectedPast = Math.min(usaTotalTarget, elapsedPastWeeks * (row.targetUSAPerWeek ?? 0));
    const usaCompletedPast = relevantRows.filter((assignment) => assignment.baseType === "USA" && assignment.date < currentWeekStart && COMPLETED_STATUSES.has(assignment.status)).length;
    const usaFutureScheduled = relevantRows.filter((assignment) => assignment.baseType === "USA" && assignment.date >= today && PROJECTABLE_FUTURE_STATUSES.has(assignment.status)).length;
    const usaDebt = Math.max(0, usaExpectedPast - (usaCompletedPast + usaFutureScheduled));

    const cruTotalTarget = row.targetCRUTotal > 0
      ? row.targetCRUTotal
      : Math.max(0, (row.targetCRUPerWeek ?? 0) * 5);
    const cruCompleted = relevantRows.filter((assignment) => assignment.baseType === "CENTRAL" && COMPLETED_STATUSES.has(assignment.status)).length;
    const cruFutureScheduled = relevantRows.filter((assignment) => assignment.baseType === "CENTRAL" && assignment.date >= today && PROJECTABLE_FUTURE_STATUSES.has(assignment.status)).length;
    const cruDebt = Math.max(0, cruTotalTarget - (cruCompleted + cruFutureScheduled));

    const crlCompleted = relevantRows.filter((assignment) => assignment.baseType === "CRL" && COMPLETED_STATUSES.has(assignment.status)).length;
    const crlFutureScheduled = relevantRows.filter((assignment) => assignment.baseType === "CRL" && assignment.date >= today && PROJECTABLE_FUTURE_STATUSES.has(assignment.status)).length;
    const crlDebt = Math.max(0, (row.targetCRLPerWeek ?? 0) - (crlCompleted + crlFutureScheduled));

    const unresolvedAbsence = relevantRows.filter((assignment) => assignment.status === "ABSENT" && !(assignment.absenceJustification && assignment.absenceJustification.trim().length > 0)).length;

    pendingByIntern.set(row.userId, {
      internId: row.userId,
      name: row.name,
      facultyAbbr: row.facultyAbbr,
      cruDebt,
      usaDebt,
      crlDebt,
      targetShifts: row.targetShifts,
      totalCompleted: row.totalCompleted,
      unresolvedAbsence,
      attendance: [],
    });
  }

  for (const assignment of pendingAttendance) {
    if (!pendingByIntern.has(assignment.internId)) {
      pendingByIntern.set(assignment.internId, {
        internId: assignment.internId,
        name: assignment.internName,
        facultyAbbr: "",
        cruDebt: 0,
        usaDebt: 0,
        crlDebt: 0,
        targetShifts: 0,
        totalCompleted: 0,
        unresolvedAbsence: 0,
        attendance: [],
      });
    }
    pendingByIntern.get(assignment.internId)!.attendance.push(assignment);
  }

  const pendingRows = [...pendingByIntern.values()]
    .filter((row) => (
      row.cruDebt > 0
      || row.usaDebt > 0
      || row.crlDebt > 0
      || row.unresolvedAbsence > 0
      || row.attendance.length > 0
    ))
    .sort((left, right) => {
      const leftWeight = left.unresolvedAbsence * 100 + left.cruDebt * 10 + left.usaDebt * 10 + left.crlDebt * 10;
      const rightWeight = right.unresolvedAbsence * 100 + right.cruDebt * 10 + right.usaDebt * 10 + right.crlDebt * 10;
      if (leftWeight !== rightWeight) return rightWeight - leftWeight;
      const leftDate = left.attendance[0]?.date;
      const rightDate = right.attendance[0]?.date;
      if (leftDate && rightDate && leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
      if (leftDate && !rightDate) return -1;
      if (!leftDate && rightDate) return 1;
      if (left.cruDebt !== right.cruDebt) return right.cruDebt - left.cruDebt;
      return left.name.localeCompare(right.name);
    });

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

      {/* Pendencias do leader: semanas anteriores + check-in vencido */}
      {pendingRows.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-700" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-red-900">Pendencias</h2>
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{pendingRows.length}</span>
          </div>
          <div className="space-y-2">
            {pendingRows.map((row) => {
              const fs = getFacultyStyle(row.facultyAbbr || null);
              const attendancePreview = row.attendance.slice(0, 3);
              const isExpanded = expandedPendingInternId === row.internId;
              const personAssignments = monitorAssignments
                .filter((assignment) => assignment.internId === row.internId)
                .slice()
                .sort((left, right) => right.date.localeCompare(left.date));
              const completedRows = personAssignments.filter((assignment) => ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(assignment.status));
              const cruDone = completedRows.filter((assignment) => assignment.baseType === "CENTRAL").length;
              const usaDone = completedRows.filter((assignment) => assignment.baseType === "USA").length;
              const crlDone = completedRows.filter((assignment) => assignment.baseType === "CRL").length;
              return (
                <div key={row.internId} className="rounded-lg border border-red-200 bg-white/90 px-3 py-2.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedPendingInternId(isExpanded ? null : row.internId)}
                      className="font-semibold text-red-800 hover:underline"
                    >
                      {row.name}
                    </button>
                    <Link
                      href={`/leader/internos?internId=${row.internId}`}
                      className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-100"
                    >
                      Ver no histórico
                    </Link>
                    {row.facultyAbbr && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${fs.pill}`}>
                        {row.facultyAbbr}
                      </span>
                    )}
                    <Link
                      href="/leader/escala"
                      className="ml-auto inline-flex items-center gap-1 rounded-md bg-accent-50 px-2 py-1 text-accent-700 font-medium hover:bg-accent-100 transition-colors"
                    >
                      Alocar <ArrowRight className="h-3 w-3" strokeWidth={2} />
                    </Link>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {row.cruDebt > 0 && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                        Débito CRU: -{row.cruDebt}
                      </span>
                    )}
                    {row.usaDebt > 0 && (
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-800">
                        Débito USA: -{row.usaDebt}
                      </span>
                    )}
                    {row.crlDebt > 0 && (
                      <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-800">
                        Débito CRL: -{row.crlDebt}
                      </span>
                    )}
                    {row.unresolvedAbsence > 0 && (
                      <span className="rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800">
                        Faltas sem resposta: {row.unresolvedAbsence}
                      </span>
                    )}
                    {attendancePreview.map((assignment) => (
                      <span key={assignment.id} className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-800">
                        Sem check-in {assignment.baseCode} {dayLabel(assignment.date)} {shortDate(assignment.date)} {periodEmoji(assignment.period)}
                      </span>
                    ))}
                    {row.attendance.length > attendancePreview.length && (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                        +{row.attendance.length - attendancePreview.length} pendencia(s)
                      </span>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                          <p className="text-[10px] uppercase text-slate-500">Realizados</p>
                          <p className="text-sm font-semibold text-slate-900">{row.totalCompleted}<span className="text-xs text-slate-500">/{row.targetShifts || 0}</span></p>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                          <p className="text-[10px] uppercase text-slate-500">CRU</p>
                          <p className="text-sm font-semibold text-violet-700">{cruDone}</p>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                          <p className="text-[10px] uppercase text-slate-500">USA</p>
                          <p className="text-sm font-semibold text-blue-700">{usaDone}</p>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                          <p className="text-[10px] uppercase text-slate-500">CRL</p>
                          <p className="text-sm font-semibold text-fuchsia-700">{crlDone}</p>
                        </div>
                      </div>

                      <div>
                        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Histórico recente</h3>
                        {personAssignments.length > 0 ? (
                          <div className="space-y-1.5">
                            {personAssignments.slice(0, 12).map((assignment) => (
                              <div key={assignment.id} className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-slate-900">{assignment.baseCode}</span>
                                  <span className="text-[11px] text-slate-500">{shortDate(assignment.date)} {dayLabel(assignment.date)} {periodEmoji(assignment.period)}</span>
                                  <span className="ml-auto"><StatusBadge status={assignment.status} /></span>
                                </div>
                                {assignment.status === "ABSENT" && (
                                  <p className={`mt-1 text-[11px] ${assignment.absenceJustification ? "text-slate-600" : "text-red-600"}`}>
                                    {assignment.absenceJustification ? `Justificada: ${assignment.absenceJustification}` : "Sem justificativa registrada."}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-500">Sem histórico recente.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="pt-1 text-[11px] text-red-700">
              Mostra pendências históricas por tipo (CRU/USA/CRL), considerando realizados + agendados projetados, além de faltas sem justificativa e check-in vencido (após 07h diurno, 19h noturno).
            </p>
              </div>
        </div>
      )}

      {/* Archive candidates: active interns with no activity in 21+ days */}
      {archiveCandidates.length > 0 && (
        <div className="rounded-xl border border-slate-300 bg-slate-50/60 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="mb-3 flex items-center gap-2">
            <Archive className="h-4 w-4 text-slate-500" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-700">Sem atividade nos últimos 21 dias</h2>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">{archiveCandidates.length}</span>
            <button
              type="button"
              onClick={() => handleArchiveAllCandidates(archiveCandidates)}
              disabled={archivingAll}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60 transition-colors"
            >
              {archivingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" strokeWidth={1.5} />}
              Arquivar todos ({archiveCandidates.length})
            </button>
          </div>
          <div className="space-y-2">
            {archiveCandidates.map((row) => {
              const fs = getFacultyStyle(row.facultyAbbr || null);
              const isArchiving = archivingId === row.userId;
              const internAllAssignments = monitorAssignmentsByIntern.get(row.userId) ?? [];
              const lastDate = internAllAssignments
                .filter((a) => a.date <= today)
                .sort((left, right) => right.date.localeCompare(left.date))[0]?.date ?? null;
              return (
                <div key={row.userId} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white/90 px-3 py-2.5 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-slate-800 truncate">{row.name}</span>
                    {row.facultyAbbr && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${fs.pill}`}>
                        {row.facultyAbbr}
                      </span>
                    )}
                    {lastDate && (
                      <span className="text-[10px] text-slate-400">último: {shortDate(lastDate)}</span>
                    )}
                    {!lastDate && (
                      <span className="text-[10px] text-slate-400">sem plantão registrado</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleArchiveIntern(row.userId)}
                    disabled={isArchiving}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60 transition-colors"
                  >
                    {isArchiving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" strokeWidth={1.5} />}
                    Arquivar
                  </button>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Internos ativos sem nenhum plantão (realizado ou agendado) nos últimos 21 dias. Arquivar remove da escala e das pendências.
          </p>
        </div>
      )}

      {/* Weekly goal tracking */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Meta Semanal e Vida da Escala</h2>
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
                    const truth = weeklyTruthByIntern.get(c.userId) ?? {
                      usaCount: 0,
                      cruCount: 0,
                      crlCount: 0,
                      eligibleScheduled: 0,
                      eligibleAbsent: 0,
                    };
                    const effective = truth.eligibleScheduled - truth.eligibleAbsent;
                    const personAssignments = (weeklyAssignmentsByIntern.get(c.userId) ?? []).slice().sort((left, right) => {
                      const rank = (type: string) => {
                        if (type === "USA") return 0;
                        if (type === "CENTRAL") return 1;
                        if (type === "CRL") return 2;
                        return 3;
                      };
                      const typeRank = rank(left.baseType) - rank(right.baseType);
                      if (typeRank !== 0) return typeRank;
                      if (left.date !== right.date) return left.date < right.date ? -1 : 1;
                      return left.period === right.period ? 0 : left.period === "DAY" ? -1 : 1;
                    });

                    const hasUsa = truth.usaCount > 0;
                    const hasCru = truth.cruCount > 0;

                    const assignmentTags = personAssignments.map((assignment) => {
                      const checkedIn = CHECKIN_DONE.has(assignment.status);
                      const pendingNow = assignment.date === today
                        && isCurrentOperationalAssignment(assignment.date, assignment.period)
                        && !checkedIn
                        && assignment.status !== "ABSENT"
                        && assignment.status !== "CANCELLED";

                      const baseTone = assignment.baseType === "USA"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : assignment.baseType === "CENTRAL"
                          ? "border-violet-200 bg-violet-50 text-violet-800"
                          : "border-orange-200 bg-orange-50 text-orange-800";

                      const stateTone = checkedIn
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : pendingNow
                          ? "border-red-400 bg-red-50 text-red-800 shadow-[0_0_0_2px_rgba(248,113,113,0.25),0_8px_16px_rgba(248,113,113,0.20)]"
                          : baseTone;

                      return (
                        <span
                          key={assignment.id}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${stateTone}`}
                          title={`${assignment.baseCode} · ${assignment.date} · ${assignment.period === "DAY" ? "Diurno" : "Noturno"} · ${assignment.status}`}
                        >
                          <span>{assignment.baseCode}</span>
                          <span>{dayLabel(assignment.date)}</span>
                          <span>{periodEmoji(assignment.period)}</span>
                        </span>
                      );
                    });

                    return (
                      <div
                        key={c.userId}
                        className="mt-1 first:mt-0 flex flex-wrap items-start justify-between gap-3 rounded-lg bg-white/80 px-3 py-2.5 text-sm transition-colors hover:bg-white"
                      >
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-slate-900 truncate">{c.name}</span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${fs.pill}`}>
                              {c.facultyAbbr}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {!hasUsa && (
                              <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                                Sem USA
                              </span>
                            )}
                            {!hasCru && (
                              <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                                Sem CRU
                              </span>
                            )}
                            {assignmentTags.length > 0 ? assignmentTags : (
                              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">
                                Sem USA/CRU/CRL na semana
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-xs sm:mt-0">
                          <span className={`font-medium tabular-nums ${effective >= c.targetShiftsPerWeek ? "text-emerald-600" : "text-red-600"}`}>
                            {effective}/{c.targetShiftsPerWeek}
                          </span>
                          {truth.eligibleAbsent > 0 && (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700 font-medium">
                              {truth.eligibleAbsent} falta{truth.eligibleAbsent > 1 ? "s" : ""}
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
