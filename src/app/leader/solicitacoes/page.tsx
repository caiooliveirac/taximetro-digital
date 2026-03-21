"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, Trash2, PlusCircle, CheckCircle, X, AlertTriangle } from "lucide-react";

type Request = {
  id: string; type: string; status: string; createdAt: string;
  requesterId: string; requesterName: string;
  assignmentDate: string | null; assignmentPeriod: string | null;
  baseCode: string | null; baseName: string | null;
  targetInternId: string | null; targetInternName: string | null;
  targetAssignmentDate: string | null; targetAssignmentPeriod: string | null;
  targetBaseCode: string | null;
  extraBaseCode: string | null; extraDate: string | null; extraPeriod: string | null;
  reviewNotes: string | null;
};

const TYPE_LABEL: Record<string, string> = { SWAP: "Troca", EXTRA_SHIFT: "Extra", DROP_SHIFT: "Descarte" };
const TYPE_ICON: Record<string, typeof ArrowLeftRight> = { SWAP: ArrowLeftRight, EXTRA_SHIFT: PlusCircle, DROP_SHIFT: Trash2 };
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente", APPROVED: "Aprovada", COMPLETED: "Concluída",
  REJECTED: "Rejeitada", ESCALATED: "Escalada", OPEN: "Aberta", CANCELLED: "Cancelada",
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  OPEN: "bg-blue-50 text-blue-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-700",
  ESCALATED: "bg-orange-50 text-orange-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default function LeaderSolicitacoes() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<{ id: string; reviewNotes: string } | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "SWAP">("ALL");

  async function load() {
    try {
      const res = await fetch("/taximetro/api/requests");
      const json = await res.json();
      if (json.success) setRequests(json.data);
      setError("");
    } catch {
      setError("Erro ao carregar solicitações.");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function review(status: string) {
    if (!reviewing) return;
    setSaving(true); setActionError("");
    try {
      const res = await fetch("/taximetro/api/requests", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reviewing.id, status, reviewNotes: reviewing.reviewNotes }),
      });
      const json = await res.json();
      if (!json.success) { setActionError(json.error || "Erro ao processar."); setSaving(false); return; }
      setReviewing(null);
      load();
    } catch {
      setActionError("Erro de conexão.");
    }
    setSaving(false);
  }

  const filtered = requests.filter((r) => {
    if (filter === "PENDING") return ["PENDING", "ESCALATED"].includes(r.status) && r.type !== "SWAP";
    if (filter === "SWAP") return r.type === "SWAP";
    return true;
  });

  // Count pending drop/extra that need review
  const pendingCount = requests.filter((r) => ["PENDING", "ESCALATED"].includes(r.status) && r.type !== "SWAP").length;

  if (loading) return <p className="text-slate-400">Carregando...</p>;
  if (error) return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Solicitações</h1>
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
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key as typeof filter)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${filter === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Review modal */}
      {reviewing && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
          <h2 className="font-semibold text-slate-900">Analisar Solicitação</h2>
          <input placeholder="Observação (opcional)" value={reviewing.reviewNotes} onChange={(e) => setReviewing({ ...reviewing, reviewNotes: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
          {actionError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}
          <div className="flex gap-2">
            <button onClick={() => review("APPROVED")} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
              {saving ? "..." : "Aprovar"}
            </button>
            <button onClick={() => review("REJECTED")} disabled={saving} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50">
              {saving ? "..." : "Rejeitar"}
            </button>
            <button onClick={() => review("ESCALATED")} disabled={saving} className="rounded-lg bg-amber-500 px-4 py-2 text-sm text-white hover:bg-amber-600 disabled:opacity-50">
              {saving ? "..." : "Escalar"}
            </button>
            <button onClick={() => { setReviewing(null); setActionError(""); }} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Request list */}
      <div className="space-y-2">
        {filtered.map((r) => {
          const Icon = TYPE_ICON[r.type] ?? ArrowLeftRight;
          const isSwap = r.type === "SWAP";
          const canReview = !isSwap && ["PENDING", "ESCALATED"].includes(r.status);

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
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">{new Date(r.createdAt).toLocaleDateString("pt-BR")}</span>
                {canReview ? (
                  <button onClick={() => setReviewing({ id: r.id, reviewNotes: "" })} className="text-xs font-medium text-accent-600 hover:text-accent-500">
                    Analisar
                  </button>
                ) : isSwap ? (
                  <span className="text-[11px] text-blue-500">Auto-gerida</span>
                ) : null}
              </div>

              {r.reviewNotes && <p className="text-[11px] text-slate-400 italic">{r.reviewNotes}</p>}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Nenhuma solicitação{filter !== "ALL" ? " nesta categoria" : ""}.</p>}
    </div>
  );
}
