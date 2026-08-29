"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, Trash2, PlusCircle, Search, ChevronDown, ChevronUp } from "lucide-react";
import { isTodayOrFutureRequest } from "@/features/requests/domain/request-shift-window";
import { useRequestDecision, DecisionButtons } from "@/components/pending-approvals";

type Request = {
  id: string; type: string; status: string; createdAt: string;
  requesterId: string; requesterName: string;
  assignmentDate: string | null; assignmentPeriod: string | null; assignmentShift: string | null;
  baseCode: string | null; baseName: string | null;
  targetInternId: string | null; targetInternName: string | null;
  targetAssignmentDate: string | null; targetAssignmentPeriod: string | null; targetAssignmentShift: string | null;
  targetBaseCode: string | null;
  extraBaseCode: string | null; extraDate: string | null; extraPeriod: string | null;
  reviewNotes: string | null;
};

type SwapShift = { baseCode: string; baseName: string; date: string; period: string; shift?: string | null; assignmentStatus: string };
type SwapHistoryEntry = {
  id: string; completedAt: string;
  requester: { id: string; name: string; gave: SwapShift | null; received: SwapShift | null };
  target: { id: string | null; name: string | null; gave: SwapShift | null; received: SwapShift | null };
};

const TYPE_LABEL: Record<string, string> = { SWAP: "Troca", EXTRA_SHIFT: "Extra", DROP_SHIFT: "Descarte" };
const TYPE_ICON: Record<string, typeof ArrowLeftRight> = { SWAP: ArrowLeftRight, EXTRA_SHIFT: PlusCircle, DROP_SHIFT: Trash2 };
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente", APPROVED: "Aprovada", COMPLETED: "Concluída",
  REJECTED: "Recusada", ESCALATED: "Escalada", OPEN: "Aberta", CANCELLED: "Cancelada",
  AWAITING_AUTH: "Aguardando preceptor",
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  OPEN: "bg-blue-50 text-blue-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-700",
  ESCALATED: "bg-orange-50 text-orange-700",
  CANCELLED: "bg-slate-100 text-slate-500",
  AWAITING_AUTH: "bg-violet-50 text-violet-700",
};

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default function LeaderSolicitacoes() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [swapHistory, setSwapHistory] = useState<SwapHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Cai em Pendentes: quem abre Solicitações vem decidir, não navegar.
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "SWAP" | "SWAP_HISTORY">("PENDING");
  const [historySearch, setHistorySearch] = useState("");
  const [expandedInterns, setExpandedInterns] = useState<Set<string>>(new Set());

  async function load() {
    try {
      const [reqRes, shRes] = await Promise.all([
        fetch("/taximetro/api/requests"),
        fetch("/taximetro/api/requests/swap-history"),
      ]);
      const [reqJson, shJson] = await Promise.all([reqRes.json(), shRes.json()]);
      if (reqJson.success) setRequests(reqJson.data);
      if (shJson.success) setSwapHistory(shJson.data);
      setError("");
    } catch {
      setError("Erro ao carregar solicitações.");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Aprovar/recusar direto do card: sem tela intermediária e sem escalar —
  // a decisão cabe em um clique. A chamada em si mora no hook compartilhado
  // com o dashboard.
  const { decide, deciding, error: actionError } = useRequestDecision(load);

  // A tela é de decisão, não de arquivo: plantão de data passada sai da lista.
  // Hoje continua aparecendo o dia inteiro, turno em curso ou não. Histórico
  // de trocas segue na aba própria.
  const now = new Date();
  const upcoming = requests.filter((r) => isTodayOrFutureRequest(r, now));

  const filtered = upcoming.filter((r) => {
    if (filter === "PENDING") return ["PENDING", "ESCALATED"].includes(r.status) && r.type !== "SWAP";
    if (filter === "SWAP") return r.type === "SWAP";
    return true;
  });

  // Count pending drop/extra that need review
  const pendingCount = upcoming.filter((r) => ["PENDING", "ESCALATED"].includes(r.status) && r.type !== "SWAP").length;

  if (loading) return <p className="text-slate-400">Carregando...</p>;
  if (error) return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Solicitações</h1>
          <p className="text-xs text-slate-500">Somente plantões de hoje em diante.</p>
        </div>
        {pendingCount > 0 && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">
            {pendingCount} pendente{pendingCount > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {([
          ["ALL", "Todas"],
          ["PENDING", `Pendentes (${pendingCount})`],
          ["SWAP", "Trocas"],
          ["SWAP_HISTORY", "📋 Histórico"],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key as typeof filter)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${filter === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══════ SWAP HISTORY TAB ═══════ */}
      {filter === "SWAP_HISTORY" && (() => {
        // Group by intern
        const internMap = new Map<string, { name: string; swaps: SwapHistoryEntry[] }>();
        for (const sw of swapHistory) {
          for (const participant of [sw.requester, sw.target]) {
            if (!participant.id || !participant.name) continue;
            if (!internMap.has(participant.id)) internMap.set(participant.id, { name: participant.name, swaps: [] });
            const entry = internMap.get(participant.id)!;
            if (!entry.swaps.some((s) => s.id === sw.id)) entry.swaps.push(sw);
          }
        }
        const internEntries = [...internMap.entries()]
          .filter(([, v]) => !historySearch || v.name.toLowerCase().includes(historySearch.toLowerCase()))
          .sort((a, b) => a[1].name.localeCompare(b[1].name));

        const toggleIntern = (id: string) => {
          setExpandedInterns((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          });
        };

        return (
          <div className="space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text" placeholder="Buscar interno..."
                value={historySearch} onChange={(e) => setHistorySearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              />
            </div>

            <p className="text-xs text-slate-500">{swapHistory.length} troca{swapHistory.length !== 1 ? "s" : ""} concluída{swapHistory.length !== 1 ? "s" : ""} · {internMap.size} interno{internMap.size !== 1 ? "s" : ""}</p>

            {internEntries.map(([internId, { name, swaps }]) => {
              const isOpen = expandedInterns.has(internId);
              return (
                <div key={internId} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                  <button onClick={() => toggleIntern(internId)}
                    className="flex w-full items-center justify-between px-4 py-3 hover:bg-slate-50 transition">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{name}</span>
                      <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-[11px] font-medium">{swaps.length} troca{swaps.length > 1 ? "s" : ""}</span>
                    </div>
                    {isOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100 divide-y divide-slate-50">
                      {swaps.map((sw) => {
                        const isRequester = sw.requester.id === internId;
                        const me = isRequester ? sw.requester : sw.target;
                        const other = isRequester ? sw.target : sw.requester;
                        return (
                          <div key={sw.id} className="px-4 py-3 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-slate-500">com <strong className="text-slate-700">{other.name}</strong></p>
                              <span className="text-[11px] text-slate-400">{new Date(sw.completedAt).toLocaleDateString("pt-BR")}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                              <div className="flex items-center gap-1.5">
                                <span className="text-red-500 font-medium">Deu</span>
                                {me.gave && (
                                  <span className="font-medium text-slate-700">
                                    {me.gave.baseCode} · {fmtDate(me.gave.date)} {me.gave.period === "DAY" ? "☀️" : "🌙"}
                                  </span>
                                )}
                              </div>
                              <ArrowLeftRight className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                              <div className="flex items-center gap-1.5">
                                <span className="text-emerald-600 font-medium">Recebeu</span>
                                {me.received && (
                                  <span className="font-medium text-slate-700">
                                    {me.received.baseCode} · {fmtDate(me.received.date)} {me.received.period === "DAY" ? "☀️" : "🌙"}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {internEntries.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-500">
                {historySearch ? "Nenhum interno encontrado." : "Nenhuma troca concluída."}
              </p>
            )}
          </div>
        );
      })()}

      {/* Request list (non-history tabs) */}
      {filter !== "SWAP_HISTORY" && (<>
        <div className="space-y-2">
          {filtered.map((r) => {
            const Icon = TYPE_ICON[r.type] ?? ArrowLeftRight;
            const isSwap = r.type === "SWAP";
            const canReview = !isSwap && ["PENDING", "ESCALATED"].includes(r.status);
            const busy = deciding === r.id;

            return (
              <div key={r.id} className={`rounded-lg border bg-white px-4 py-3 space-y-1.5 ${canReview ? "border-amber-200" : "border-slate-200"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                    <span className="text-sm font-medium text-slate-900">{TYPE_LABEL[r.type]}</span>
                    <span className="text-xs text-slate-500">— {r.requesterName}</span>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </div>

                {/* Details row */}
                <div className="text-xs text-slate-500">
                  {r.type === "DROP_SHIFT" && r.baseCode && r.assignmentDate && (
                    <span>Descartar: {r.baseCode} · {fmtDate(r.assignmentDate)} {r.assignmentPeriod === "DAY" ? "☀️" : "🌙"}</span>
                  )}
                  {r.type === "EXTRA_SHIFT" && r.extraBaseCode && r.extraDate && (
                    <span>Extra em: {r.extraBaseCode} · {fmtDate(r.extraDate)} {r.extraPeriod === "DAY" ? "☀️" : "🌙"}</span>
                  )}
                  {isSwap && r.baseCode && r.assignmentDate && (
                    <span>
                      Oferece: {r.baseCode} · {fmtDate(r.assignmentDate)} {r.assignmentPeriod === "DAY" ? "☀️" : "🌙"}
                      {r.targetInternName && r.targetBaseCode && r.targetAssignmentDate && (
                        <span className="ml-2">
                          ↔ {r.targetInternName}: {r.targetBaseCode} · {fmtDate(r.targetAssignmentDate)} {r.targetAssignmentPeriod === "DAY" ? "☀️" : "🌙"}
                        </span>
                      )}
                    </span>
                  )}
                </div>

                {/* Date + action row */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400">{new Date(r.createdAt).toLocaleDateString("pt-BR")}</span>
                  {canReview ? (
                    <DecisionButtons id={r.id} busy={busy} onDecide={decide} />
                  ) : isSwap ? (
                    <span className="text-[11px] text-blue-500">Auto-gerida</span>
                  ) : null}
                </div>

                {actionError?.id === r.id && (
                  <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{actionError.message}</div>
                )}

                {r.reviewNotes && <p className="text-[11px] text-slate-400 italic">{r.reviewNotes}</p>}
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            Nenhuma solicitação de hoje em diante{filter !== "ALL" ? " nesta categoria" : ""}.
          </p>
        )}
      </>)}
    </div>
  );
}
