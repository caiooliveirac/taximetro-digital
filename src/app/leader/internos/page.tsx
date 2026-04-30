"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  UserPlus, Link2, Copy, Check, Clock, UserCheck, UserX, Trash2, Target,
  ChevronDown, Calendar, MapPin, Sun, Moon, ArrowRight, Plus, X, Repeat,
  Archive, ArchiveRestore,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { AbsenceJustificationDialog } from "@/components/absence-justification-dialog";
import { useImpersonate } from "@/components/impersonate/impersonate-provider";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { getFacultyStyle } from "@/lib/base-colors";
import { getBaseStyle, getPeriodStyle } from "@/lib/base-colors";

type UserRow = {
  id: string;
  name: string;
  cpf: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  isArchived?: boolean;
  role?: string;
  facultyAbbr: string | null;
  createdAt?: string;
};

type ComplianceRow = {
  userId: string;
  name: string;
  targetShifts: number;
  targetShiftsPerWeek: number;
  totalCompleted: number;
  totalAbsent: number;
  totalDeficit: number;
  totalPct: number | null;
  thisWeekCompleted: number;
  thisWeekScheduled: number;
  thisWeekAbsent: number;
  belowWeeklyTarget: boolean;
  futureScheduled: number;
  rawDeficit: number;
  netDeficit: number;
  status: "ok" | "compensating" | "partial" | "deficit";
};

type AssignmentRow = {
  id: string;
  internId: string;
  baseCode: string;
  baseName: string;
  baseType?: string;
  date: string;
  period: string;
  status: string;
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
  absenceJustificationActor?: string | null;
  absenceJustificationAt?: string | null;
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

type InviteLink = {
  id: string;
  token: string;
  facultyAbbr: string | null;
  isActive: boolean;
  createdAt: string;
};

type SwapSlot = {
  baseCode: string; baseName: string; date: string; period: string;
};
type SwapHistoryEntry = {
  id: string; completedAt: string;
  requester: { id: string; name: string; gave: SwapSlot | null; received: SwapSlot | null };
  target: { id: string | null; name: string | null; gave: SwapSlot | null; received: SwapSlot | null };
};

type Tab = "ativos" | "pendentes" | "convites" | "arquivados";

type AvailableSlot = {
  baseId: string; baseCode: string; baseName: string; baseType: string;
  dayOfWeek: string; period: string; capacity: number; filled: number; available: number;
  nextDate: string;
};

const DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export default function LeaderInternos() {
  const { data: session } = useSession();
  const [focusInternId, setFocusInternId] = useState<string | null>(null);
  const { target: impersonateTarget } = useImpersonate();
  const effectiveFacultyId = impersonateTarget?.facultyId ?? session?.user?.facultyId;
  const [tab, setTab] = useState<Tab>("ativos");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [archivedUsers, setArchivedUsers] = useState<UserRow[]>([]);
  const [compliance, setCompliance] = useState<ComplianceRow[]>([]);
  const [internAssignmentsById, setInternAssignmentsById] = useState<Record<string, AssignmentRow[]>>({});
  const [caseRecordsByInternId, setCaseRecordsByInternId] = useState<Record<string, CaseRecord[]>>({});
  const [loadingHistoryById, setLoadingHistoryById] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<UserRow[]>([]);
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [expandedAssignmentId, setExpandedAssignmentId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [justificationAssignment, setJustificationAssignment] = useState<AssignmentRow | null>(null);
  const [swapHistory, setSwapHistory] = useState<SwapHistoryEntry[]>([]);
  const [userNameById, setUserNameById] = useState<Record<string, string>>({});

  /* ── Allocation modal ── */
  const [allocIntern, setAllocIntern] = useState<{ id: string; name: string } | null>(null);
  const [allocSlots, setAllocSlots] = useState<AvailableSlot[]>([]);
  const [allocBaseId, setAllocBaseId] = useState("");
  const [allocDate, setAllocDate] = useState("");
  const [allocPeriod, setAllocPeriod] = useState<"DAY" | "NIGHT">("DAY");
  const [allocLoading, setAllocLoading] = useState(false);
  const [allocMsg, setAllocMsg] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [usersRes, pendingRes, linksRes, complianceRes, swapRes] = await Promise.all([
        fetch("/taximetro/api/admin/users").then((r) => r.json()),
        fetch("/taximetro/api/leader/pendentes").then((r) => r.json()),
        fetch("/taximetro/api/leader/convites").then((r) => r.json()),
        fetch("/taximetro/api/compliance").then((r) => r.json()),
        fetch("/taximetro/api/requests/swap-history").then((r) => r.json()),
      ]);
      if (usersRes.success) {
        const usersMap = Object.fromEntries((usersRes.data as Array<{ id: string; name: string }>).map((u) => [u.id, u.name]));
        setUserNameById(usersMap);
        const allInterns = usersRes.data.filter((u: UserRow) => u.role === "INTERN" && u.isActive);
        setUsers(allInterns.filter((u: UserRow) => !u.isArchived));
        setArchivedUsers(allInterns.filter((u: UserRow) => u.isArchived));
      }
      if (pendingRes.success) setPending(pendingRes.data);
      if (linksRes.success) setLinks(linksRes.data.filter((l: InviteLink) => l.isActive));
      if (complianceRes.success) setCompliance(complianceRes.data);
      if (swapRes.success) setSwapHistory(swapRes.data);
      setError("");
    } catch {
      setError("Erro ao carregar dados. Tente recarregar a página.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const internId = new URLSearchParams(window.location.search).get("internId");
    setFocusInternId(internId);
  }, []);

  async function loadInternAssignments(internId: string) {
    if (internAssignmentsById[internId] || loadingHistoryById[internId]) return;

    setLoadingHistoryById((current) => ({ ...current, [internId]: true }));
    try {
      const [assignResponse, caseRecordsResponse] = await Promise.all([
        fetch(`/taximetro/api/assignments?internId=${internId}`),
        fetch(`/taximetro/api/case-records?internId=${internId}`),
      ]);

      const assignJson = await assignResponse.json();
      const caseRecordsJson = await caseRecordsResponse.json();

      if (assignJson.success) {
        const rows: AssignmentRow[] = (assignJson.data as AssignmentRow[])
          .filter((assignment) => assignment.status !== "CANCELLED")
          .sort((left, right) => right.date.localeCompare(left.date));
        setInternAssignmentsById((current) => ({ ...current, [internId]: rows }));
      } else {
        setInternAssignmentsById((current) => ({ ...current, [internId]: [] }));
      }

      if (caseRecordsJson.success) {
        setCaseRecordsByInternId((current) => ({ ...current, [internId]: caseRecordsJson.data as CaseRecord[] }));
      } else {
        setCaseRecordsByInternId((current) => ({ ...current, [internId]: [] }));
      }
    } catch {
      setInternAssignmentsById((current) => ({ ...current, [internId]: [] }));
      setCaseRecordsByInternId((current) => ({ ...current, [internId]: [] }));
    } finally {
      setLoadingHistoryById((current) => ({ ...current, [internId]: false }));
    }
  }

  useEffect(() => {
    if (!focusInternId || tab !== "ativos") return;
    if (!users.some((user) => user.id === focusInternId)) return;

    setExpandedId(focusInternId);
    setExpandedAssignmentId(null);
    void loadInternAssignments(focusInternId);
  }, [focusInternId, tab, users]);

  async function generateLink() {
    try {
      const res = await fetch("/taximetro/api/leader/convites", { method: "POST" });
      const json = await res.json();
      if (json.success) { loadData(); setActionMsg({ type: "success", text: "Link gerado!" }); }
      else setActionMsg({ type: "error", text: json.error || "Erro ao gerar link." });
    } catch {
      setActionMsg({ type: "error", text: "Erro de conexão ao gerar link." });
    }
  }

  async function deactivateLink(id: string) {
    try {
      await fetch(`/taximetro/api/leader/convites?id=${id}`, { method: "DELETE" });
      loadData();
    } catch {
      setActionMsg({ type: "error", text: "Erro ao desativar link." });
    }
  }

  async function handleAction(userId: string, action: "approve" | "reject") {
    setActing(userId);
    try {
      const res = await fetch("/taximetro/api/leader/pendentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action }),
      });
      const json = await res.json();
      if (!json.success) setActionMsg({ type: "error", text: json.error || "Erro ao processar." });
      else setActionMsg({ type: "success", text: action === "approve" ? "Interno aprovado!" : "Interno rejeitado." });
      loadData();
    } catch {
      setActionMsg({ type: "error", text: "Erro de conexão." });
    }
    setActing(null);
  }

  async function handleArchive(userId: string, archive: boolean) {
    setActing(userId);
    try {
      const res = await fetch("/taximetro/api/leader/interns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action: archive ? "archive" : "unarchive" }),
      });
      const json = await res.json();
      if (!json.success) setActionMsg({ type: "error", text: json.error || "Erro ao processar." });
      else setActionMsg({ type: "success", text: archive ? "Interno arquivado." : "Interno desarquivado." });
      setExpandedId(null);
      loadData();
    } catch {
      setActionMsg({ type: "error", text: "Erro de conexão." });
    }
    setActing(null);
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/taximetro/registro/${token}`;
    navigator.clipboard.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  }

  async function openAllocModal(intern: { id: string; name: string }) {
    setAllocIntern(intern);
    setAllocBaseId("");
    setAllocDate("");
    setAllocPeriod("DAY");
    setAllocMsg("");
    // Fetch available slots
    try {
      const res = await fetch("/taximetro/api/slots/available");
      const json = await res.json();
      if (json.success) setAllocSlots(json.data.filter((s: AvailableSlot) => s.available > 0));
    } catch {
      setAllocSlots([]);
    }
  }

  async function submitAllocation() {
    if (!allocIntern || !allocBaseId || !allocDate || !effectiveFacultyId) return;
    setAllocLoading(true);
    setAllocMsg("");
    try {
      const res = await fetch("/taximetro/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          internId: allocIntern.id,
          facultyId: effectiveFacultyId,
          baseId: allocBaseId,
          date: allocDate,
          period: allocPeriod,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setAllocMsg("✅ Alocado com sucesso!");
        await loadData();
        setTimeout(() => setAllocIntern(null), 800);
      } else {
        setAllocMsg(`❌ ${json.error}`);
      }
    } catch {
      setAllocMsg("❌ Erro de conexão.");
    }
    setAllocLoading(false);
  }

  function handleJustificationSaved(assignmentId: string, data: {
    absenceJustification: string | null;
    absenceJustificationActor: string | null;
    absenceJustificationAt: string | null;
  }) {
    setInternAssignmentsById((current) => {
      const next: Record<string, AssignmentRow[]> = {};
      for (const [internId, assignments] of Object.entries(current)) {
        next[internId] = assignments.map((assignment) => assignment.id === assignmentId ? { ...assignment, ...data } : assignment);
      }
      return next;
    });
  }

  /* ── Derive available dates from selected base ── */
  const allocDatesForBase = allocSlots
    .filter((s) => s.baseId === allocBaseId && Boolean(s.nextDate))
    .map((s) => {
      const date = s.nextDate;
      const jsDay = new Date(`${date}T12:00:00Z`).getUTCDay();
      const dayIdx = jsDay === 0 ? 6 : jsDay - 1;
      return { date, period: s.period as "DAY" | "NIGHT", dayLabel: DAY_LABELS[dayIdx] };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const filtered = users.filter(
    (u) => !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.cpf.includes(search)
  );

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "ativos", label: "Ativos", count: users.length },
    { key: "arquivados", label: "Arquivados", count: archivedUsers.length },
    { key: "pendentes", label: "Pendentes", count: pending.length },
    { key: "convites", label: "Links", count: links.length },
  ];

  if (loading) return <p className="text-slate-500">Carregando...</p>;
  if (error) return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Internos</h1>
        <Button onClick={generateLink} size="sm" className="gap-2">
          <Link2 className="h-4 w-4" />
          Gerar Link de Convite
        </Button>
      </div>

      {actionMsg && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${actionMsg.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {actionMsg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${tab === t.key
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-900"
              }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-medium ${t.key === "pendentes" && t.count > 0
                ? "bg-amber-100 text-amber-700"
                : "bg-slate-200 text-slate-500"
                }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Ativos */}
      {tab === "ativos" && (
        <div className="space-y-3">
          <input
            placeholder="Buscar por nome ou CPF..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500"
          />
          <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium text-center">Plantões</th>
                  <th className="px-4 py-3 font-medium text-center">Faltas</th>
                  <th className="px-4 py-3 font-medium text-center hidden sm:table-cell">Progresso</th>
                  <th className="px-4 py-3 font-medium text-center hidden sm:table-cell">Semana</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const c = compliance.find((cr) => cr.userId === u.id);
                  const isExpanded = expandedId === u.id;
                  const allAssignmentsForIntern = internAssignmentsById[u.id] ?? [];
                  const loadingHistory = loadingHistoryById[u.id] ?? false;
                  const internAssignments = isExpanded
                    ? allAssignmentsForIntern
                    : [];
                  const internCompleted = isExpanded
                    ? allAssignmentsForIntern.filter((a) => ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(a.status))
                    : [];
                  const cruCount = internCompleted.filter((a) => a.baseType === "CENTRAL").length;
                  const usaCount = internCompleted.filter((a) => a.baseType === "USA").length;
                  const crlCount = internCompleted.filter((a) => a.baseType === "CRL").length;
                  const internSwaps = isExpanded
                    ? swapHistory.filter((s) => s.requester.id === u.id || s.target.id === u.id)
                    : [];

                  return (
                    <tr
                      key={u.id}
                      className={`border-b border-slate-100 last:border-0 cursor-pointer transition-colors ${isExpanded ? "bg-slate-50" : "hover:bg-slate-50/50"}`}
                      onClick={() => {
                        const nextExpanded = isExpanded ? null : u.id;
                        setExpandedId(nextExpanded);
                        setExpandedAssignmentId(null);
                        if (nextExpanded) {
                          void loadInternAssignments(nextExpanded);
                        }
                      }}
                    >
                      <td colSpan={6} className="p-0">
                        {/* Main row content */}
                        <div className="flex items-center">
                          <div className="flex-1 px-4 py-3 min-w-0">
                            <div className="font-medium text-slate-900">{u.name}</div>
                            <div className="text-xs text-slate-400 font-mono">{u.cpf}</div>
                          </div>
                          <div className="px-4 py-3 text-center w-20">
                            {c ? (
                              <span className="text-slate-900 font-medium">{c.totalCompleted}</span>
                            ) : "—"}
                            {c && c.targetShifts > 0 && (
                              <span className="text-slate-400 text-xs">/{c.targetShifts}</span>
                            )}
                          </div>
                          <div className="px-4 py-3 text-center w-16">
                            {c && c.totalAbsent > 0 ? (
                              <span className="text-red-600 font-medium">{c.totalAbsent}</span>
                            ) : (
                              <span className="text-slate-300">0</span>
                            )}
                          </div>
                          <div className="px-4 py-3 hidden sm:block w-28">
                            {c && c.totalPct !== null ? (
                              <div className="mx-auto flex w-24 items-center gap-1.5">
                                <div className="h-2 flex-1 rounded-full bg-slate-100">
                                  <div
                                    className={`h-2 rounded-full transition-all ${c.totalPct >= 100 ? "bg-emerald-500" : c.totalPct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                                    style={{ width: `${c.totalPct}%` }}
                                  />
                                </div>
                                <span className="text-xs text-slate-500 tabular-nums">{c.totalPct}%</span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-300 text-center block">—</span>
                            )}
                          </div>
                          <div className="px-4 py-3 text-center hidden sm:block w-28">
                            {c && c.targetShiftsPerWeek > 0 ? (
                              c.status === "ok" ? (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700">
                                  {c.thisWeekCompleted}/{c.targetShiftsPerWeek}
                                </span>
                              ) : c.status === "compensating" ? (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                                  Compensando
                                </span>
                              ) : c.status === "partial" ? (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700">
                                  <Target className="h-3 w-3" strokeWidth={2} />
                                  −{c.netDeficit}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700">
                                  <Target className="h-3 w-3" strokeWidth={2} />
                                  −{c.rawDeficit}
                                </span>
                              )
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </div>
                          <div className="px-2 py-3 w-8">
                            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} strokeWidth={1.5} />
                          </div>
                        </div>

                        {/* Expanded detail panel */}
                        {isExpanded && (
                          <div className="border-t border-slate-100 px-4 py-4 space-y-4 bg-slate-50/50" onClick={(e) => e.stopPropagation()}>
                            {/* Compliance summary */}
                            {c && (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                  <p className="text-[10px] font-medium text-slate-500 uppercase">Esta semana</p>
                                  <p className="text-lg font-bold text-slate-900">{c.thisWeekScheduled - c.thisWeekAbsent}<span className="text-sm text-slate-400">/{c.targetShiftsPerWeek}</span></p>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                  <p className="text-[10px] font-medium text-slate-500 uppercase">Realizados</p>
                                  <p className="text-lg font-bold text-slate-900">{c.totalCompleted}<span className="text-sm text-slate-400">/{c.targetShifts}</span></p>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                  <p className="text-[10px] font-medium text-slate-500 uppercase">Agendados</p>
                                  <p className="text-lg font-bold text-slate-900">{c.futureScheduled}</p>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                  <p className="text-[10px] font-medium text-slate-500 uppercase">Faltas</p>
                                  <p className={`text-lg font-bold ${c.totalAbsent > 0 ? "text-red-600" : "text-slate-900"}`}>{c.totalAbsent}</p>
                                </div>
                              </div>
                            )}

                            {/* Base type boxes */}
                            {(cruCount > 0 || usaCount > 0 || crlCount > 0) && (
                              <div className="grid grid-cols-3 gap-2">
                                <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-center">
                                  <p className="text-lg font-bold text-violet-700">{cruCount}</p>
                                  <p className="text-[10px] font-medium text-violet-600">CRU</p>
                                </div>
                                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center">
                                  <p className="text-lg font-bold text-red-700">{usaCount}</p>
                                  <p className="text-[10px] font-medium text-red-600">USA</p>
                                </div>
                                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-center">
                                  <p className="text-lg font-bold text-rose-700">{crlCount}</p>
                                  <p className="text-[10px] font-medium text-rose-600">CRL</p>
                                </div>
                              </div>
                            )}

                            {/* Swap history */}
                            {internSwaps.length > 0 && (
                              <div>
                                <div className="flex items-center gap-1.5 mb-2">
                                  <Repeat className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />
                                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Trocas ({internSwaps.length})</h3>
                                </div>
                                <div className="space-y-1.5">
                                  {internSwaps.slice(0, 5).map((swap) => {
                                    const isReq = swap.requester.id === u.id;
                                    const self = isReq ? swap.requester : swap.target;
                                    const peer = isReq ? swap.target : swap.requester;
                                    return (
                                      <div key={swap.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm">
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="text-[11px] text-slate-400">
                                            {new Date(swap.completedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                                          </span>
                                          <span className="text-[11px] text-slate-400">com {peer.name}</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div className="rounded bg-red-50 px-2 py-1">
                                            <p className="text-[10px] font-medium text-red-600">Deu</p>
                                            {self.gave ? (
                                              <span className="text-xs font-medium text-slate-900">
                                                {self.gave.baseCode} {new Date(self.gave.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                                                <span className={`ml-1 ${self.gave.period === "DAY" ? "text-amber-600" : "text-indigo-600"}`}>{self.gave.period === "DAY" ? "☀" : "🌙"}</span>
                                              </span>
                                            ) : <span className="text-xs text-slate-400">—</span>}
                                          </div>
                                          <div className="rounded bg-emerald-50 px-2 py-1">
                                            <p className="text-[10px] font-medium text-emerald-600">Recebeu</p>
                                            {self.received ? (
                                              <span className="text-xs font-medium text-slate-900">
                                                {self.received.baseCode} {new Date(self.received.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                                                <span className={`ml-1 ${self.received.period === "DAY" ? "text-amber-600" : "text-indigo-600"}`}>{self.received.period === "DAY" ? "☀" : "🌙"}</span>
                                              </span>
                                            ) : <span className="text-xs text-slate-400">—</span>}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Recent assignments */}
                            <div>
                              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Histórico de plantões</h3>
                              {loadingHistory ? (
                                <p className="text-xs text-slate-400">Carregando histórico...</p>
                              ) : internAssignments.length > 0 ? (
                                <div className="space-y-1">
                                  {internAssignments.map((a) => {
                                    const isAssignmentExpanded = expandedAssignmentId === a.id;
                                    const bs = getBaseStyle(a.baseType);
                                    const ps = getPeriodStyle(a.period);
                                    const records = (caseRecordsByInternId[u.id] ?? []).filter((record) => record.assignmentId === a.id);
                                    return (
                                      <div key={a.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm">
                                        <button
                                          type="button"
                                          onClick={() => setExpandedAssignmentId(isAssignmentExpanded ? null : a.id)}
                                          className="flex w-full items-center gap-3 text-left"
                                        >
                                          <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${bs.dot}`} />
                                          <span className="font-medium text-slate-900 w-14">{a.baseCode}</span>
                                          <span className="text-xs text-slate-500 w-20">
                                            {new Date(a.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                                          </span>
                                          <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${ps.text}`}>
                                            {a.period === "DAY" ? <Sun className="h-3 w-3" strokeWidth={1.5} /> : <Moon className="h-3 w-3" strokeWidth={1.5} />}
                                            {ps.label}
                                          </span>
                                          <span className="ml-auto"><StatusBadge status={a.status} /></span>
                                        </button>
                                        {a.status === "ABSENT" && (
                                          <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-2 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="min-w-0 text-xs text-slate-500">
                                              {a.absenceJustification
                                                ? <p className="truncate">{a.absenceJustification}</p>
                                                : <p className="text-amber-600">Sem justificativa registrada.</p>}
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => setJustificationAssignment(a)}
                                              className="shrink-0 text-xs font-medium text-accent-600 hover:text-accent-500"
                                            >
                                              {a.absenceJustification ? "Ver ou editar justificativa" : "Justificar falta"}
                                            </button>
                                          </div>
                                        )}
                                        {isAssignmentExpanded && (
                                          <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
                                            <p><span className="font-semibold">Check-in:</span> {a.checkinAt ? new Date(a.checkinAt).toLocaleString("pt-BR") : "—"}</p>
                                            <p><span className="font-semibold">Validação check-in:</span> {a.totpValidatedAt ? new Date(a.totpValidatedAt).toLocaleString("pt-BR") : "—"}</p>
                                            <p><span className="font-semibold">Validado por:</span> {a.validatedBy ? (userNameById[a.validatedBy] ?? a.validatedBy) : (a.validatedByName ? a.validatedByName : (a.totpValidatedAt ? "Telegram" : "—"))}</p>
                                            <p><span className="font-semibold">Checkout:</span> {a.checkoutAt ? new Date(a.checkoutAt).toLocaleString("pt-BR") : "—"}</p>
                                            <p><span className="font-semibold">Checkout confirmado por:</span> {a.checkoutConfirmedBy ? (userNameById[a.checkoutConfirmedBy] ?? a.checkoutConfirmedBy) : (a.checkoutConfirmedByName ? a.checkoutConfirmedByName : (a.checkoutAt ? "Telegram" : "—"))}</p>
                                            <p><span className="font-semibold">Observação do interno:</span> {a.internObservations || "—"}</p>
                                            <p><span className="font-semibold">Observação do preceptor:</span> {a.preceptorObservations || "—"}</p>
                                            <p><span className="font-semibold">Notas de checkout:</span> {a.checkoutNotes || "—"}</p>
                                            <div>
                                              <p className="font-semibold">Ocorrências clínicas:</p>
                                              {records.length > 0 ? (
                                                <ul className="mt-1 space-y-1">
                                                  {records.map((record) => (
                                                    <li key={record.id} className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                                                      <span className="font-medium">#{record.caseNumber} · {record.nickname}</span>
                                                      {record.description ? <span> — {record.description}</span> : null}
                                                    </li>
                                                  ))}
                                                </ul>
                                              ) : (
                                                <p>—</p>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400">Nenhum plantão registrado.</p>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 flex-wrap">
                              <button
                                onClick={() => openAllocModal({ id: u.id, name: u.name })}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                              >
                                <Plus className="h-4 w-4" strokeWidth={2} />
                                Alocar
                              </button>
                              <Link href="/leader/escala" className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700 transition-colors">
                                <Calendar className="h-4 w-4" strokeWidth={1.5} />
                                Ver escala
                                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                              </Link>
                              <button
                                onClick={() => handleArchive(u.id, true)}
                                disabled={acting === u.id}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
                              >
                                <Archive className="h-4 w-4" strokeWidth={1.5} />
                                Arquivar
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="flex flex-col items-center py-12 text-slate-400">
                <UserPlus className="h-8 w-8 mb-2" />
                <p className="text-sm">Nenhum interno ativo encontrado.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Pendentes */}
      {tab === "pendentes" && (
        <div className="space-y-3">
          {pending.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <Clock className="h-8 w-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nenhum registro pendente de aprovação.</p>
            </div>
          ) : (
            pending.map((u) => (
              <div key={u.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{u.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{u.cpf} · {u.email}</p>
                    {u.phone && <p className="text-xs text-slate-500">{u.phone}</p>}
                    {u.createdAt && (
                      <p className="text-xs text-slate-400 mt-1">
                        Registrado em {new Date(u.createdAt).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAction(u.id, "reject")}
                      disabled={acting === u.id}
                      className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
                    >
                      <UserX className="h-4 w-4" />
                      <span className="hidden sm:inline">Rejeitar</span>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleAction(u.id, "approve")}
                      disabled={acting === u.id}
                      className="gap-1"
                    >
                      <UserCheck className="h-4 w-4" />
                      <span className="hidden sm:inline">Aprovar</span>
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Links de Convite */}
      {tab === "convites" && (
        <div className="space-y-3">
          {links.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <Link2 className="h-8 w-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nenhum link ativo. Clique em &quot;Gerar Link de Convite&quot;.</p>
            </div>
          ) : (
            links.map((link) => {
              const url = `${typeof window !== "undefined" ? window.location.origin : ""}/taximetro/registro/${link.token}`;
              return (
                <div key={link.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs text-slate-500">{url}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Criado em {new Date(link.createdAt).toLocaleDateString("pt-BR")}
                        {link.facultyAbbr && ` · ${link.facultyAbbr}`}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => copyLink(link.token)} className="gap-1">
                        {copied === link.token ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        {copied === link.token ? "Copiado" : "Copiar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deactivateLink(link.id)}
                        className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab: Arquivados */}
      {tab === "arquivados" && (
        <div className="space-y-3">
          {archivedUsers.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <Archive className="h-8 w-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nenhum interno arquivado.</p>
              <p className="text-xs text-slate-400 mt-1">Internos de turmas anteriores podem ser arquivados na aba Ativos.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="px-4 py-3 font-medium">Nome</th>
                    <th className="px-4 py-3 font-medium text-center">CPF</th>
                    <th className="w-28"></th>
                  </tr>
                </thead>
                <tbody>
                  {archivedUsers.map((u) => (
                    <tr key={u.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{u.name}</div>
                        <div className="text-xs text-slate-400">{u.email}</div>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-slate-500 font-mono">{u.cpf}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleArchive(u.id, false)}
                          disabled={acting === u.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" strokeWidth={1.5} />
                          Desarquivar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ Allocation Modal ═══════════ */}
      {allocIntern && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-4 text-white flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Plus className="h-5 w-5" /> Alocar Interno
                </h2>
                <p className="text-sm text-blue-100">{allocIntern.name}</p>
              </div>
              <button onClick={() => setAllocIntern(null)} className="rounded-lg p-1.5 hover:bg-white/20 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Base:</label>
                <select
                  value={allocBaseId}
                  onChange={(e) => { setAllocBaseId(e.target.value); setAllocDate(""); }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="">— Escolher base —</option>
                  {[...new Map(allocSlots.map((s) => [s.baseId, s])).values()]
                    .sort((a, b) => a.baseCode.localeCompare(b.baseCode))
                    .map((s) => (
                      <option key={s.baseId} value={s.baseId}>
                        {s.baseCode} — {s.baseName} ({s.baseType})
                      </option>
                    ))}
                </select>
              </div>
              {allocBaseId && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Dia e turno:</label>
                  <div className="grid grid-cols-2 gap-2">
                    {allocDatesForBase.map((slot) => (
                      <button
                        key={`${slot.date}|${slot.period}`}
                        onClick={() => { setAllocDate(slot.date); setAllocPeriod(slot.period); }}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${allocDate === slot.date && allocPeriod === slot.period
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                      >
                        {slot.dayLabel} {new Date(slot.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                        <span className="ml-1">{slot.period === "DAY" ? "☀️" : "🌙"}</span>
                      </button>
                    ))}
                  </div>
                  {allocDatesForBase.length === 0 && (
                    <p className="text-xs text-slate-400 mt-1">Nenhuma vaga disponível nesta base para a semana atual.</p>
                  )}
                </div>
              )}
              {allocMsg && <p className="text-sm">{allocMsg}</p>}
            </div>
            <div className="border-t border-slate-200 px-6 py-4 bg-slate-50/50 flex gap-2">
              <button
                onClick={() => setAllocIntern(null)}
                className="flex-1 rounded-lg bg-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 transition"
              >
                Cancelar
              </button>
              <button
                onClick={submitAllocation}
                disabled={allocLoading || !allocBaseId || !allocDate}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-bold text-white hover:bg-blue-700 transition disabled:opacity-50"
              >
                {allocLoading ? "Alocando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

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
        title="Justificar falta do aluno"
        onClose={() => setJustificationAssignment(null)}
        onSaved={handleJustificationSaved}
      />
    </div>
  );
}
