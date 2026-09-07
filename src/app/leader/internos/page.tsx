"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  UserPlus, Link2, Copy, Check, Clock, UserCheck, UserX, Trash2, Target,
  ChevronRight, Calendar, ArrowRight, Plus, X,
  Archive, ArchiveRestore,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { useImpersonate } from "@/components/impersonate/impersonate-provider";
import { Button } from "@/components/ui/button";
import { VelocimeterCard } from "@/components/admin/velocimeter-card";
import { SwapHistoryList } from "@/components/admin/intern-shifts-blocks";
import { InternHistorySection } from "@/components/admin/intern-history-section";

type UserRow = {
  id: string;
  name: string;
  cpf: string;
  email: string;
  phone: string | null;
  selfie?: string | null;
  isActive: boolean;
  isArchived?: boolean;
  role?: string;
  facultyAbbr: string | null;
  createdAt?: string;
};

type PhotoChangeRequestRow = {
  id: string;
  userId: string;
  userName: string;
  email: string;
  facultyId: string | null;
  facultyAbbr: string | null;
  currentSelfie: string | null;
  requestedSelfie: string;
  requestedAt: string;
  status: string;
};

type ComplianceRow = {
  userId: string;
  name: string;
  targetShifts: number;
  totalCompleted: number;
  totalAbsent: number;
  totalDeficit: number;
  totalPct: number | null;
  thisWeekCompleted: number;
  thisWeekScheduled: number;
  thisWeekAbsent: number;
  missingSlots?: number;
  futureScheduled: number;
  rawDeficit: number;
  netDeficit: number;
  status: "ok" | "compensating" | "partial" | "deficit";
  rotationStartDate: string | null;
  rotationEndDate: string | null;
  targetUSATotal?: number;
  targetCRUTotal?: number;
  targetCRLTotal?: number;
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
  const [pending, setPending] = useState<UserRow[]>([]);
  const [pendingPhotoChanges, setPendingPhotoChanges] = useState<PhotoChangeRequestRow[]>([]);
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [selectedInternId, setSelectedInternId] = useState<string | null>(null);
  // Turma de cada interno, como o servidor devolve em /api/leader/interns.
  const [cohortLabelById, setCohortLabelById] = useState<Record<string, string | null>>({});
  const [error, setError] = useState("");
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [zoomedPhoto, setZoomedPhoto] = useState<{ src: string; alt: string } | null>(null);
  const [swapHistory, setSwapHistory] = useState<SwapHistoryEntry[]>([]);

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
      const [usersRes, scopedRes, pendingRes, linksRes, complianceRes, swapRes] = await Promise.all([
        fetch("/taximetro/api/admin/users").then((r) => r.json()),
        // Quem é "meu interno" quem decide é o servidor: /api/leader/interns já
        // devolve a faculdade do líder recortada na turma dele. A lista de
        // usuários traz o cadastro (CPF, e-mail); a turma vem daqui.
        fetch("/taximetro/api/leader/interns").then((r) => r.json()).catch(() => ({ success: false })),
        fetch("/taximetro/api/leader/pendentes").then((r) => r.json()),
        fetch("/taximetro/api/leader/convites").then((r) => r.json()),
        fetch("/taximetro/api/compliance").then((r) => r.json()),
        fetch("/taximetro/api/requests/swap-history").then((r) => r.json()),
      ]);

      type ScopedIntern = {
        id: string; userActive: boolean; roleActive: boolean; isArchived: boolean;
        cohortName: string | null; cohortLabel: string | null;
      };
      // Sem o recorte (coordenador entrando direto na tela do líder, ou falha da
      // rota), a lista degrada para o comportamento antigo: a faculdade inteira.
      const scoped: ScopedIntern[] | null = scopedRes?.success ? scopedRes.data : null;
      if (scoped) {
        setCohortLabelById(Object.fromEntries(scoped.map((r) => [r.id, r.cohortName ?? r.cohortLabel])));
      }
      const inScope = (id: string) => !scoped || scoped.some((r) => r.id === id && r.roleActive && r.userActive);

      if (usersRes.success) {
        const allInterns = (usersRes.data as UserRow[]).filter((u) => u.role === "INTERN" && u.isActive && inScope(u.id));
        setUsers(allInterns.filter((u) => !u.isArchived));
        setArchivedUsers(allInterns.filter((u) => u.isArchived));
      }
      if (pendingRes.success) {
        setPending(pendingRes.data.users ?? []);
        setPendingPhotoChanges(pendingRes.data.photoChanges ?? []);
      }
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


  useEffect(() => {
    if (!focusInternId || tab !== "ativos") return;
    if (!users.some((user) => user.id === focusInternId)) return;
    setSelectedInternId(focusInternId);
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
      setSelectedInternId(null);
      loadData();
    } catch {
      setActionMsg({ type: "error", text: "Erro de conexão." });
    }
    setActing(null);
  }

  async function handlePhotoAction(requestId: string, action: "approve" | "reject") {
    setActing(requestId);
    try {
      const res = await fetch("/taximetro/api/leader/photo-change-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      const json = await res.json();
      if (!json.success) setActionMsg({ type: "error", text: json.error || "Erro ao processar troca de foto." });
      else setActionMsg({ type: "success", text: action === "approve" ? "Troca de foto aprovada!" : "Troca de foto rejeitada." });
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

  const selectedIntern = selectedInternId ? users.find((u) => u.id === selectedInternId) ?? null : null;
  const selectedSwaps = selectedIntern
    ? swapHistory.filter((swap) => swap.requester.id === selectedIntern.id || swap.target.id === selectedIntern.id)
    : [];

  const filtered = users.filter(
    (u) => !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.cpf.includes(search)
  );

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "ativos", label: "Ativos", count: users.length },
    { key: "arquivados", label: "Arquivados", count: archivedUsers.length },
    { key: "pendentes", label: "Pendentes", count: pending.length + pendingPhotoChanges.length },
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

      {/* Tab: Ativos — ficha do interno selecionado */}
      {tab === "ativos" && selectedIntern && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedInternId(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50"
              >
                ← Voltar
              </button>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-slate-900">{selectedIntern.name}</p>
                <p className="text-xs text-slate-500">
                  {[
                    selectedIntern.facultyAbbr,
                    cohortLabelById[selectedIntern.id],
                    selectedIntern.cpf,
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => openAllocModal({ id: selectedIntern.id, name: selectedIntern.name })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" strokeWidth={2} />
                Alocar
              </button>
              <Link href="/leader/escala" className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700">
                <Calendar className="h-4 w-4" strokeWidth={1.5} />
                Ver escala
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>
              <button
                onClick={() => handleArchive(selectedIntern.id, true)}
                disabled={acting === selectedIntern.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
              >
                <Archive className="h-4 w-4" strokeWidth={1.5} />
                Arquivar
              </button>
            </div>
          </div>

          {/* Mesma ficha que o coordenador vê: velocímetro, casinhas da meta,
              plantões com detalhe de check-in/checkout e ocorrências. */}
          <InternHistorySection internId={selectedIntern.id} />

          <SwapHistoryList
            swaps={selectedSwaps}
            currentInternId={selectedIntern.id}
            initialLimit={5}
            density="compact"
          />
        </div>
      )}

      {/* Tab: Ativos — lista */}
      {tab === "ativos" && !selectedIntern && (
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
                  <th className="px-4 py-3 font-medium text-center hidden sm:table-cell">Meta</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const c = compliance.find((cr) => cr.userId === u.id);

                  return (
                    <tr
                      key={u.id}
                      className="border-b border-slate-100 last:border-0 cursor-pointer transition-colors hover:bg-slate-50/50"
                      onClick={() => setSelectedInternId(u.id)}
                    >
                      <td colSpan={6} className="p-0">
                        {/* Main row content */}
                        <div className="flex items-center">
                          <div className="flex-1 px-4 py-3 min-w-0">
                            <div className="font-medium text-slate-900">{u.name}</div>
                            <div className="text-xs text-slate-400">
                              <span className="font-mono">{u.cpf}</span>
                              {cohortLabelById[u.id] && <span> · {cohortLabelById[u.id]}</span>}
                            </div>
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
                          <div className="px-4 py-3 hidden sm:block w-44">
                            {c && c.targetShifts > 0 ? (
                              <VelocimeterCard
                                variant="compact"
                                data={{
                                  completed: c.totalCompleted,
                                  target: c.targetShifts,
                                  rotationStartDate: c.rotationStartDate,
                                  rotationEndDate: c.rotationEndDate,
                                }}
                              />
                            ) : (
                              <span className="text-xs text-slate-300 text-center block">—</span>
                            )}
                          </div>
                          <div className="px-4 py-3 text-center hidden sm:block w-28">
                            {c && c.targetShifts > 0 ? (
                              (c.missingSlots ?? 0) > 0 ? (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700">
                                  ⚠️ {c.missingSlots} vaga{(c.missingSlots ?? 0) > 1 ? "s" : ""}
                                </span>
                              ) : c.status === "ok" ? (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700">
                                  {c.totalCompleted}/{c.targetShifts}
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
                            <ChevronRight className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
                          </div>
                        </div>

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
          {pending.length === 0 && pendingPhotoChanges.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <Clock className="h-8 w-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nenhuma pendência de aprovação.</p>
            </div>
          ) : (
            <>
              {pending.length > 0 && (
                <div className="space-y-3">
                  <div className="px-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Novos usuários</p>
                  </div>
                  {pending.map((u) => (
                    <div key={u.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                          {u.selfie ? (
                            <button
                              type="button"
                              onClick={() => setZoomedPhoto({ src: u.selfie!, alt: `Foto de ${u.name}` })}
                              className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                              aria-label={`Ampliar foto de ${u.name}`}
                            >
                              <img
                                src={u.selfie}
                                alt={`Foto de ${u.name}`}
                                className="h-14 w-14 rounded-full object-cover ring-2 ring-slate-200"
                              />
                            </button>
                          ) : (
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-[10px] text-slate-400">
                              Sem foto
                            </div>
                          )}
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
                  ))}
                </div>
              )}

              {pendingPhotoChanges.length > 0 && (
                <div className="space-y-3">
                  <div className="px-1 pt-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trocas de foto</p>
                  </div>
                  {pendingPhotoChanges.map((request) => (
                    <div key={request.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                      <div className="flex flex-col gap-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">{request.userName}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{request.email}{request.facultyAbbr ? ` · ${request.facultyAbbr}` : ""}</p>
                            <p className="text-xs text-slate-400 mt-1">
                              Solicitação enviada em {new Date(request.requestedAt).toLocaleString("pt-BR")}
                            </p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePhotoAction(request.id, "reject")}
                              disabled={acting === request.id}
                              className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
                            >
                              <UserX className="h-4 w-4" />
                              <span className="hidden sm:inline">Rejeitar</span>
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handlePhotoAction(request.id, "approve")}
                              disabled={acting === request.id}
                              className="gap-1"
                            >
                              <UserCheck className="h-4 w-4" />
                              <span className="hidden sm:inline">Aprovar</span>
                            </Button>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Foto atual</p>
                            {request.currentSelfie ? (
                              <button
                                type="button"
                                onClick={() => setZoomedPhoto({ src: request.currentSelfie!, alt: `Foto atual de ${request.userName}` })}
                                className="mx-auto block rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                                aria-label={`Ampliar foto atual de ${request.userName}`}
                              >
                                <img src={request.currentSelfie} alt="Foto atual" className="h-24 w-24 rounded-full object-cover ring-2 ring-slate-200" />
                              </button>
                            ) : (
                              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border border-dashed border-slate-300 text-xs text-slate-400">
                                Sem foto
                              </div>
                            )}
                          </div>
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Nova foto</p>
                            <button
                              type="button"
                              onClick={() => setZoomedPhoto({ src: request.requestedSelfie, alt: `Nova foto de ${request.userName}` })}
                              className="mx-auto block rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                              aria-label={`Ampliar nova foto de ${request.userName}`}
                            >
                              <img src={request.requestedSelfie} alt="Nova foto solicitada" className="h-24 w-24 rounded-full object-cover ring-2 ring-amber-200" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
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


      {zoomedPhoto && (
        <PhotoLightbox
          src={zoomedPhoto.src}
          alt={zoomedPhoto.alt}
          onClose={() => setZoomedPhoto(null)}
        />
      )}
    </div>
  );
}
