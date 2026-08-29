"use client";

import { useState } from "react";
import { Trash2, PlusCircle, CheckCircle, X } from "lucide-react";

export type PendingRequest = {
  id: string;
  type: string;
  status: string;
  requesterName: string;
  assignmentDate: string | null;
  assignmentPeriod: string | null;
  baseCode: string | null;
  extraBaseCode: string | null;
  extraDate: string | null;
  extraPeriod: string | null;
};

const TYPE_LABEL: Record<string, string> = { EXTRA_SHIFT: "Extra", DROP_SHIFT: "Descarte" };
const TYPE_ICON: Record<string, typeof Trash2> = { EXTRA_SHIFT: PlusCircle, DROP_SHIFT: Trash2 };

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/**
 * Aprovar/recusar uma solicitação. Uma implementação só da chamada, dividida
 * entre o dashboard e a tela de Solicitações — se o contrato do PUT mudar, muda
 * em um lugar. `onChanged` recarrega a tela que estiver usando.
 */
export function useRequestDecision(onChanged: () => void | Promise<void>) {
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  async function decide(id: string, status: "APPROVED" | "REJECTED") {
    setDeciding(id);
    setError(null);
    try {
      const res = await fetch("/taximetro/api/requests", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!json.success) {
        setError({ id, message: json.error || "Erro ao processar." });
        setDeciding(null);
        return;
      }
      await onChanged();
    } catch {
      setError({ id, message: "Erro de conexão." });
    }
    setDeciding(null);
  }

  return { decide, deciding, error };
}

/** O par Aprovar/Recusar. Mesmo botão nas duas telas. */
export function DecisionButtons({
  id,
  busy,
  onDecide,
}: {
  id: string;
  busy: boolean;
  onDecide: (id: string, status: "APPROVED" | "REJECTED") => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onDecide(id, "APPROVED")} disabled={busy}
        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50">
        <CheckCircle className="h-3.5 w-3.5" strokeWidth={2} />
        {busy ? "..." : "Aprovar"}
      </button>
      <button onClick={() => onDecide(id, "REJECTED")} disabled={busy}
        className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-50">
        <X className="h-3.5 w-3.5" strokeWidth={2} />
        {busy ? "..." : "Recusar"}
      </button>
    </div>
  );
}

/**
 * Descarte e extra à espera do líder, no dashboard — para ele ver o que tem
 * para decidir assim que loga, sem passar pelo menu.
 *
 * Troca fica de fora de propósito: é auto-gerida entre internos.
 */
export function PendingApprovals({
  requests,
  onChanged,
}: {
  requests: PendingRequest[];
  onChanged: () => void | Promise<void>;
}) {
  const { decide, deciding, error } = useRequestDecision(onChanged);

  return (
    <div className="space-y-2">
      {requests.map((r) => {
        const Icon = TYPE_ICON[r.type] ?? Trash2;

        return (
          <div key={r.id} className="rounded-lg bg-white/80 px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="h-4 w-4 text-slate-400 shrink-0" strokeWidth={1.5} />
                <span className="text-sm font-medium text-slate-900">{TYPE_LABEL[r.type] ?? r.type}</span>
                <span className="text-xs text-slate-500 truncate">— {r.requesterName}</span>
              </div>
              {r.status === "ESCALATED" && (
                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 shrink-0">Escalada</span>
              )}
            </div>

            <div className="text-xs text-slate-500">
              {r.type === "DROP_SHIFT" && r.baseCode && r.assignmentDate && (
                <span>Descartar: {r.baseCode} · {fmtDate(r.assignmentDate)} {r.assignmentPeriod === "DAY" ? "☀️" : "🌙"}</span>
              )}
              {r.type === "EXTRA_SHIFT" && r.extraBaseCode && r.extraDate && (
                <span>Extra em: {r.extraBaseCode} · {fmtDate(r.extraDate)} {r.extraPeriod === "DAY" ? "☀️" : "🌙"}</span>
              )}
            </div>

            <DecisionButtons id={r.id} busy={deciding === r.id} onDecide={decide} />

            {error?.id === r.id && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error.message}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
