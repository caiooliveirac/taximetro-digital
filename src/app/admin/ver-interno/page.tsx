"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Search, User, Sun, Moon, Calendar, CheckCircle, XCircle,
  Target, Clock, Send, ArrowLeftRight, Plus, Eye,
  Repeat, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { MetricCard } from "@/components/metric-card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";
import { getFacultyStyle, getBaseStyle, getPeriodStyle, baseViewIndex } from "@/lib/base-colors";
import { operationalDateStr } from "@/lib/utils";
import { VelocimeterCard } from "@/components/admin/velocimeter-card";
import {
  RealizedByTypeBoxes,
  ShiftListByKind,
  WeekBreakdownByType,
  AssignmentDetailPanel,
} from "@/components/admin/intern-shifts-blocks";

/* ── types ── */
type Intern = { id: string; name: string; facultyAbbr: string; facultyId: string | null; isActive: boolean; cohortId: string | null; cohortName: string | null; isArchived: boolean };
type CohortOption = { id: string; name: string | null; label: string; status: string };
type Assignment = {
  id: string; internName: string; baseCode: string; baseName: string;
  baseType?: string; date: string; period: string; status: string;
  facultyAbbr: string;
  checkinStatus?: string | null;
  checkinMethod?: string | null;
  checkinAt?: string | null;
  totpValidatedAt?: string | null;
  validatedBy?: string | null;
  validatedByName?: string | null;
  checkoutAt?: string | null;
  checkoutConfirmedBy?: string | null;
  checkoutConfirmedByName?: string | null;
  checkoutNotes?: string | null;
  internObservations?: string | null;
  preceptorObservations?: string | null;
  absenceJustification?: string | null;
};
type ComplianceRow = {
  userId: string; name: string; facultyAbbr: string;
  targetShifts: number; targetShiftsPerWeek: number;
  totalCompleted: number; totalAbsent: number; totalHours: number;
  totalPct: number | null; thisWeekCompleted: number; thisWeekScheduled: number;
  thisWeekAbsent: number; rawDeficit: number; netDeficit: number;
  futureScheduled: number; status: "ok" | "compensating" | "partial" | "deficit";
  rotationStartDate: string | null; rotationEndDate: string | null;
  targetUSAPerWeek?: number; targetCRUPerWeek?: number; targetCRLPerWeek?: number;
  thisWeekUSAPlanned?: number; thisWeekCRUPlanned?: number; thisWeekCRLPlanned?: number;
  lastWeekUSACompleted?: number; lastWeekCRUCompleted?: number; lastWeekCRLCompleted?: number;
};
type Request = {
  id: string; type: string; status: string; createdAt: string;
  assignmentDate?: string; assignmentPeriod?: string; baseCode?: string;
  extraDate?: string; extraPeriod?: string;
};
type Base = { id: string; code: string; name: string };

type SwapSlot = {
  baseCode: string; baseName: string; date: string; period: string;
  shift?: string; assignmentStatus?: string;
};
type SwapHistoryEntry = {
  id: string; completedAt: string;
  requester: { id: string; name: string; gave: SwapSlot | null; received: SwapSlot | null };
  target: { id: string | null; name: string | null; gave: SwapSlot | null; received: SwapSlot | null };
};

type CaseRecord = {
  id: string;
  assignmentId: string;
  internId: string;
  caseNumber: string;
  nickname: string;
  description: string | null;
  createdAt: string;
};

const TYPE_LABEL: Record<string, string> = { SWAP: "Troca", EXTRA_SHIFT: "Extra", DROP_SHIFT: "Descarte" };
const STATUS_LABEL: Record<string, string> = { PENDING: "Pendente", APPROVED: "Aprovado", REJECTED: "Rejeitado" };

export default function AdminVerComoInternoPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500">Carregando...</div>}>
      <AdminVerComoInterno />
    </Suspense>
  );
}

function AdminVerComoInterno() {
  const searchParams = useSearchParams();
  const internIdFromUrl = searchParams.get("internId");

  /* ── intern list ── */
  const [interns, setInterns] = useState<Intern[]>([]);
  const [search, setSearch] = useState("");
  const [facultyFilter, setFacultyFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Intern | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  /* ── cohort change ── */
  const [cohortOptions, setCohortOptions] = useState<CohortOption[]>([]);
  const [changingCohort, setChangingCohort] = useState(false);
  const [cohortSelectValue, setCohortSelectValue] = useState<string>("");
  const [cohortSaving, setCohortSaving] = useState(false);

  /* ── scoped data for selected intern ── */
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [compliance, setCompliance] = useState<ComplianceRow | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [bases, setBases] = useState<Base[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [swapHistory, setSwapHistory] = useState<SwapHistoryEntry[]>([]);
  const [caseRecords, setCaseRecords] = useState<CaseRecord[]>([]);
  const [expandedAssignmentId, setExpandedAssignmentId] = useState<string | null>(null);
  const [userNameById, setUserNameById] = useState<Record<string, string>>({});

  /* ── action panel ── */
  const [actionTab, setActionTab] = useState<"EXTRA" | null>(null);
  const [extraBaseId, setExtraBaseId] = useState("");
  const [extraDate, setExtraDate] = useState("");
  const [extraPeriod, setExtraPeriod] = useState<"DAY" | "NIGHT">("DAY");
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /* ── load intern list + compliance overview (para velocímetro compact na lista) ── */
  const [complianceByIntern, setComplianceByIntern] = useState<Record<string, ComplianceRow>>({});
  useEffect(() => {
    fetch("/taximetro/api/admin/users")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          const usersMap = Object.fromEntries((json.data as Array<{ id: string; name: string }>).map((u) => [u.id, u.name]));
          setUserNameById(usersMap);
          // Filtra pelo registro INTERN específico (não a role primária do user).
          // - Multi-role LEADER+INTERN: pega faculty/cohort/isArchived do registro INTERN
          // - User com role INTERN arquivada não aparece (a menos que showArchived=true)
          type RoleEntry = { role: string; facultyId: string | null; facultyAbbr: string | null; cohortId: string | null; cohortName: string | null; isArchived?: boolean };
          type RawUser = { id: string; name: string; role: string; facultyAbbr: string; facultyId: string | null; isActive: boolean; cohortId?: string | null; cohortName?: string | null; allRoles?: RoleEntry[] };
          const internList = (json.data as RawUser[])
            .map((u) => {
              const internRole = u.allRoles?.find((r) => r.role === "INTERN");
              if (!u.isActive || !internRole) return null;
              return {
                id: u.id,
                name: u.name,
                facultyAbbr: internRole.facultyAbbr ?? "",
                facultyId: internRole.facultyId ?? null,
                isActive: u.isActive,
                cohortId: internRole.cohortId ?? null,
                cohortName: internRole.cohortName ?? null,
                isArchived: Boolean(internRole.isArchived),
              } as Intern;
            })
            .filter((i): i is Intern => i !== null)
            .sort((a, b) => a.name.localeCompare(b.name));
          setInterns(internList);
        }
      })
      .catch(() => { })
      .finally(() => setLoadingList(false));

    fetch("/taximetro/api/compliance")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          const map: Record<string, ComplianceRow> = {};
          for (const row of json.data as ComplianceRow[]) map[row.userId] = row;
          setComplianceByIntern(map);
        }
      })
      .catch(() => { });

    fetch("/taximetro/api/admin/bases")
      .then((r) => r.json())
      .then((json) => { if (json.success) setBases(json.data.filter((b: { isActive: boolean }) => b.isActive)); })
      .catch(() => { });
  }, []);

  /* ── auto-select via ?internId= ── */
  useEffect(() => {
    if (!internIdFromUrl || interns.length === 0) return;
    if (selected?.id === internIdFromUrl) return;
    const match = interns.find((i) => i.id === internIdFromUrl);
    if (match) setSelected(match);
  }, [internIdFromUrl, interns, selected?.id]);

  /* ── load data when intern selected ── */
  useEffect(() => {
    if (!selected) return;
    setLoadingData(true);
    setActionTab(null);
    setActionMsg(null);
    setExpandedAssignmentId(null);

    Promise.all([
      fetch(`/taximetro/api/assignments?internId=${selected.id}`).then((r) => r.json()),
      fetch(`/taximetro/api/compliance?internId=${selected.id}`).then((r) => r.json()),
      fetch(`/taximetro/api/requests?internId=${selected.id}`).then((r) => r.json()),
      fetch(`/taximetro/api/requests/swap-history?internId=${selected.id}`).then((r) => r.json()),
      fetch(`/taximetro/api/case-records?internId=${selected.id}`).then((r) => r.json()),
    ]).then(([aJson, cJson, rJson, shJson, crJson]) => {
      if (aJson.success) {
        setAssignments(
          aJson.data
            .filter((a: Assignment) => a.status !== "CANCELLED")
            .sort((a: Assignment, b: Assignment) => {
              if (a.date !== b.date) return a.date.localeCompare(b.date);
              return baseViewIndex(a.baseCode) - baseViewIndex(b.baseCode);
            })
        );
      }
      if (cJson.success && cJson.data.length > 0) setCompliance(cJson.data[0]);
      else setCompliance(null);
      if (rJson.success) setRequests(rJson.data);
      if (shJson.success) setSwapHistory(shJson.data);
      else setSwapHistory([]);
      if (crJson.success) setCaseRecords(crJson.data);
      else setCaseRecords([]);
    })
      .catch(() => { })
      .finally(() => setLoadingData(false));
  }, [selected]);

  /* ── load cohort options when intern selected ── */
  useEffect(() => {
    if (!selected?.facultyId) { setCohortOptions([]); return; }
    fetch(`/taximetro/api/admin/cohorts?facultyId=${selected.facultyId}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setCohortOptions(json.data.filter((c: CohortOption) => c.status !== "CLOSED"));
          setCohortSelectValue(selected.cohortId ?? "");
        }
      })
      .catch(() => {});
    setChangingCohort(false);
  }, [selected]);

  async function saveCohort() {
    if (!selected) return;
    setCohortSaving(true);
    const res = await fetch(`/taximetro/api/admin/users?id=${selected.id}`);
    const json = await res.json();
    const internRole = json.data?.[0]?.allRoles?.find((r: { id: string | null; role: string; facultyId: string | null }) => r.role === "INTERN" && r.facultyId === selected.facultyId);
    if (!internRole?.id) { setCohortSaving(false); return; }
    const patchRes = await fetch("/taximetro/api/admin/interns/cohort", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userRoleId: internRole.id as string, cohortId: cohortSelectValue || null }),
    });
    const patchJson = await patchRes.json();
    if (patchJson.success) {
      const newCohort = cohortOptions.find((c) => c.id === cohortSelectValue);
      setSelected((prev) => prev ? { ...prev, cohortId: cohortSelectValue || null, cohortName: newCohort?.name ?? newCohort?.label ?? null } : prev);
      setInterns((prev) => prev.map((i) => i.id === selected.id ? { ...i, cohortId: cohortSelectValue || null, cohortName: newCohort?.name ?? newCohort?.label ?? null } : i));
      setChangingCohort(false);
    }
    setCohortSaving(false);
  }

  /* ── actions ── */
  async function submitAction() {
    if (!selected || !actionTab) return;
    setSubmitting(true);
    setActionMsg(null);
    const body: Record<string, string> =
      { type: "EXTRA_SHIFT", extraBaseId, extraDate, extraPeriod, onBehalfOf: selected.id };

    try {
      const res = await fetch("/taximetro/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        setActionMsg({ type: "success", text: `Solicitação criada em nome de ${selected.name}` });
        // Refresh requests
        try {
          const rRes = await fetch(`/taximetro/api/requests?internId=${selected.id}`);
          const rJson = await rRes.json();
          if (rJson.success) setRequests(rJson.data);
        } catch { /* ignore refresh failure */ }
      } else {
        setActionMsg({ type: "error", text: json.error });
      }
    } catch {
      setActionMsg({ type: "error", text: "Erro de conexão. Tente novamente." });
    } finally {
      setSubmitting(false);
    }
  }

  /* ── filtered intern list ── */
  const facultyOptions = useMemo(() => {
    const set = new Set<string>();
    interns.forEach((i) => { if (i.facultyAbbr) set.add(i.facultyAbbr); });
    return Array.from(set).sort();
  }, [interns]);
  const filteredInterns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return interns.filter((i) => {
      if (!showArchived && i.isArchived) return false;
      if (facultyFilter && i.facultyAbbr !== facultyFilter) return false;
      if (q && !(i.name.toLowerCase().includes(q) || i.facultyAbbr?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [interns, search, facultyFilter, showArchived]);

  /* ── derived ── */
  const today = operationalDateStr();
  const todayAssignment = assignments.find((a) => a.date === today);
  const upcoming = assignments.filter((a) => a.date > today);
  const pastAssignments = assignments.filter((a) => a.date <= today);
  const present = pastAssignments.filter((a) => ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "EXCUSED"].includes(a.status)).length;
  const absent = pastAssignments.filter((a) => a.status === "ABSENT").length;

  const weeklyEffective = compliance ? compliance.thisWeekScheduled - (compliance.thisWeekAbsent ?? 0) : 0;
  const weeklyGoal = compliance?.targetShiftsPerWeek ?? 0;
  const caseRecordsByAssignment = useMemo(() => {
    const grouped = new Map<string, CaseRecord[]>();
    for (const record of caseRecords) {
      const list = grouped.get(record.assignmentId) ?? [];
      list.push(record);
      grouped.set(record.assignmentId, list);
    }
    return grouped;
  }, [caseRecords]);

  const selectClass = "block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

  /* ── no intern selected: show picker ── */
  if (!selected) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Ver Como Interno</h1>
          <p className="mt-1 text-sm text-slate-500">Selecione um interno para visualizar sua perspectiva, auditar dados e agir em seu nome.</p>
        </div>

        {/* Filtro de faculdade por botão */}
        {facultyOptions.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFacultyFilter(null)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${facultyFilter === null ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
            >
              Todas
            </button>
            {facultyOptions.map((abbr) => {
              const fs = getFacultyStyle(abbr);
              const active = facultyFilter === abbr;
              return (
                <button
                  key={abbr}
                  type="button"
                  onClick={() => setFacultyFilter(active ? null : abbr)}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${active ? `${fs.pill} ring-1 ring-slate-900` : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${fs.dot}`} />
                  {abbr}
                </button>
              );
            })}
          </div>
        )}

        <label className="inline-flex items-center gap-2 text-xs text-slate-600 select-none">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
          />
          Incluir internos arquivados
        </label>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" strokeWidth={1.5} />
          <Input
            placeholder="Buscar por nome ou faculdade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loadingList ? <TableSkeleton rows={8} cols={3} /> : (
          <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
            {filteredInterns.map((intern) => {
              const fs = getFacultyStyle(intern.facultyAbbr);
              const cmp = complianceByIntern[intern.id];
              return (
                <button
                  key={intern.id}
                  onClick={() => setSelected(intern)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <User className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-slate-900 truncate">{intern.name}</p>
                      {intern.isArchived && (
                        <span className="inline-flex items-center rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          arquivado
                        </span>
                      )}
                    </div>
                    {cmp && cmp.targetShifts > 0 && (
                      <div className="mt-0.5">
                        <VelocimeterCard
                          variant="compact"
                          data={{
                            completed: cmp.totalCompleted,
                            target: cmp.targetShifts,
                            rotationStartDate: cmp.rotationStartDate,
                            rotationEndDate: cmp.rotationEndDate,
                            weeklyTarget: cmp.targetShiftsPerWeek,
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${fs.pill}`}>
                    {intern.facultyAbbr}
                  </span>
                  <Eye className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
                </button>
              );
            })}
            {filteredInterns.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-400">Nenhum interno encontrado.</p>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ── intern dashboard ── */
  const fs = getFacultyStyle(selected.facultyAbbr);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setSelected(null); setAssignments([]); setCompliance(null); setRequests([]); }}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            ← Voltar
          </button>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{selected.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${fs.pill}`}>
                {selected.facultyAbbr}
              </span>
              {!changingCohort ? (
                <button
                  onClick={() => setChangingCohort(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 hover:border-accent-400 hover:text-accent-600 transition-colors"
                  title="Clique para mudar turma"
                >
                  {selected.cohortName ? (
                    <span className="font-medium text-emerald-700">{selected.cohortName}</span>
                  ) : (
                    <span className="italic text-slate-400">Sem turma</span>
                  )}
                  <span className="text-[10px]">✎</span>
                </button>
              ) : (
                <div className="flex items-center gap-1">
                  <select
                    value={cohortSelectValue}
                    onChange={(e) => setCohortSelectValue(e.target.value)}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-900"
                  >
                    <option value="">Sem turma</option>
                    {cohortOptions.map((c) => (
                      <option key={c.id} value={c.id}>{c.name ?? c.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={saveCohort}
                    disabled={cohortSaving}
                    className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] text-white disabled:opacity-50 hover:bg-emerald-700"
                  >
                    {cohortSaving ? "…" : "Salvar"}
                  </button>
                  <button onClick={() => setChangingCohort(false)} className="rounded px-2 py-0.5 text-[11px] text-slate-500 hover:text-slate-700">
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
          Visão do coordenador
        </div>
      </div>

      {loadingData ? <TableSkeleton rows={6} cols={4} /> : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Realizados" value={present} icon={CheckCircle} />
            <MetricCard label="Ausentes" value={absent} icon={XCircle} />
            <MetricCard label="Próximos" value={upcoming.length} icon={Calendar} />
            <MetricCard
              label="Meta semanal"
              value={weeklyGoal > 0 ? `${weeklyEffective}/${weeklyGoal}` : "—"}
              icon={Target}
            />
          </div>

          {/* Breakdown semanal por tipo (CRU/USA/CRL — esta semana vs passada) */}
          <WeekBreakdownByType compliance={compliance} />

          {/* Velocímetro da rotação */}
          {compliance && compliance.targetShifts > 0 && (
            <VelocimeterCard
              variant="card"
              data={{
                completed: compliance.totalCompleted,
                target: compliance.targetShifts,
                rotationStartDate: compliance.rotationStartDate,
                rotationEndDate: compliance.rotationEndDate,
                weeklyTarget: compliance.targetShiftsPerWeek,
              }}
            />
          )}

          {/* Today */}
          {todayAssignment && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <h2 className="text-sm font-semibold text-slate-900 mb-2">Plantão de Hoje</h2>
              <div className="flex items-center gap-3">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${getBaseStyle(todayAssignment.baseType).dot}`} />
                <span className="font-medium text-slate-900">{todayAssignment.baseCode} — {todayAssignment.baseName}</span>
                <span className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${getPeriodStyle(todayAssignment.period).bg} ${getPeriodStyle(todayAssignment.period).text}`}>
                  {todayAssignment.period === "DAY" ? <Sun className="h-3 w-3" strokeWidth={1.5} /> : <Moon className="h-3 w-3" strokeWidth={1.5} />}
                  {getPeriodStyle(todayAssignment.period).label}
                </span>
                <StatusBadge status={todayAssignment.status} />
              </div>
            </div>
          )}

          {/* Upcoming — agrupados por tipo */}
          {upcoming.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-900 mb-2">Próximos Plantões</h2>
              <ShiftListByKind
                items={upcoming}
                emptyMessage="Nenhum plantão agendado."
                showStatus
                initialLimit={10}
              />
            </div>
          )}

          {/* Requests */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-900">Solicitações</h2>
              <div className="flex gap-1">
                <Button size="sm" variant={actionTab === "EXTRA" ? "default" : "outline"} onClick={() => setActionTab(actionTab === "EXTRA" ? null : "EXTRA")}>
                  <Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} /> Extra
                </Button>
              </div>
            </div>

            {/* Action form */}
            {actionTab && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 mb-3 space-y-3">
                <p className="text-xs font-medium text-amber-700">
                  ⚠ Ação em nome de {selected.name} — ficará registrada na auditoria
                </p>
                {actionTab === "EXTRA" && (
                  <>
                    <p className="text-xs text-slate-600">Solicitação de extra não exige plantão de referência.</p>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">Base desejada</span>
                      <select value={extraBaseId} onChange={(e) => setExtraBaseId(e.target.value)} className={selectClass}>
                        <option value="">Selecionar...</option>
                        {bases.sort((a, b) => baseViewIndex(a.code) - baseViewIndex(b.code)).map((b) => (
                          <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-xs font-medium text-slate-600">Data</span>
                        <Input type="date" value={extraDate} onChange={(e) => setExtraDate(e.target.value)} className="mt-1" />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium text-slate-600">Turno</span>
                        <select value={extraPeriod} onChange={(e) => setExtraPeriod(e.target.value as "DAY" | "NIGHT")} className={selectClass}>
                          <option value="DAY">Diurno</option>
                          <option value="NIGHT">Noturno</option>
                        </select>
                      </label>
                    </div>
                  </>
                )}
                <Button onClick={submitAction} disabled={!extraBaseId || !extraDate || !extraPeriod || submitting} size="sm">
                  <Send className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
                  {submitting ? "Enviando..." : "Criar Solicitação"}
                </Button>
                {actionMsg && (
                  <div className={`rounded-lg px-3 py-2 text-sm ${actionMsg.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                    }`}>
                    {actionMsg.text}
                  </div>
                )}
              </div>
            )}

            {/* Existing requests */}
            {requests.length > 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Referência</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{TYPE_LABEL[r.type] ?? r.type}</TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {r.baseCode && `${r.baseCode} `}
                          {r.assignmentDate ?? ""}
                          {r.extraDate && ` → ${r.extraDate}`}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.status === "APPROVED" ? "confirmed" : r.status === "REJECTED" ? "absent" : "scheduled"}>
                            {STATUS_LABEL[r.status] ?? r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">{new Date(r.createdAt).toLocaleDateString("pt-BR")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
                <p className="text-sm text-slate-400">Nenhuma solicitação.</p>
              </div>
            )}
          </div>

          {/* Swap history tracking */}
          {swapHistory.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Repeat className="h-4 w-4 text-indigo-500" strokeWidth={1.5} />
                <h2 className="text-sm font-semibold text-slate-900">Histórico de Trocas ({swapHistory.length})</h2>
              </div>
              <div className="space-y-2">
                {swapHistory.map((swap) => {
                  const isRequester = swap.requester.id === selected.id;
                  const self = isRequester ? swap.requester : swap.target;
                  const peer = isRequester ? swap.target : swap.requester;
                  return (
                    <div key={swap.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-500">
                          {new Date(swap.completedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                        </span>
                        <span className="text-[11px] text-slate-400">com {peer.name}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg bg-red-50 border border-red-100 p-2">
                          <p className="text-[11px] font-medium text-red-600 mb-1">Deu</p>
                          {self.gave ? (
                            <div className="text-sm">
                              <span className="font-semibold text-slate-900">{self.gave.baseCode}</span>
                              <span className="text-slate-500 ml-1">
                                {new Date(self.gave.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                              </span>
                              <span className={`ml-1 text-[11px] ${self.gave.period === "DAY" ? "text-amber-600" : "text-indigo-600"}`}>
                                {self.gave.period === "DAY" ? "☀ D" : "🌙 N"}
                              </span>
                            </div>
                          ) : <span className="text-xs text-slate-400">—</span>}
                        </div>
                        <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2">
                          <p className="text-[11px] font-medium text-emerald-600 mb-1">Recebeu</p>
                          {self.received ? (
                            <div className="text-sm">
                              <span className="font-semibold text-slate-900">{self.received.baseCode}</span>
                              <span className="text-slate-500 ml-1">
                                {new Date(self.received.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                              </span>
                              <span className={`ml-1 text-[11px] ${self.received.period === "DAY" ? "text-amber-600" : "text-indigo-600"}`}>
                                {self.received.period === "DAY" ? "☀ D" : "🌙 N"}
                              </span>
                            </div>
                          ) : <span className="text-xs text-slate-400">—</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Completed shifts by base type */}
          {pastAssignments.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-slate-500" strokeWidth={1.5} />
                <h2 className="text-sm font-semibold text-slate-900">Plantões por Tipo (realizados)</h2>
              </div>
              <RealizedByTypeBoxes assignments={pastAssignments} />
            </div>
          )}

          {/* Past history — agrupado por tipo, com expand para detalhes */}
          {pastAssignments.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-900 mb-2">Histórico Completo</h2>
              <ShiftListByKind
                items={[...pastAssignments].reverse()}
                emptyMessage="Sem histórico."
                showStatus
                initialLimit={10}
                expandedId={expandedAssignmentId}
                onToggleExpand={setExpandedAssignmentId}
                renderDetail={(a) => (
                  <AssignmentDetailPanel
                    assignment={a as Assignment}
                    caseRecords={caseRecordsByAssignment.get(a.id) ?? []}
                    userNameById={userNameById}
                  />
                )}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
