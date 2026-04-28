"use client";

import { useCallback, useEffect, useState } from "react";
import { Zap, Clock, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { getBaseStyle } from "@/lib/base-colors";

/* ═══════════ Types ═══════════ */

type Offer = {
  id: string;
  baseId: string;
  baseCode: string;
  baseName: string;
  baseType: string;
  date: string;
  period: "DAY" | "NIGHT";
  shift: string | null;
  facultyId: string | null;
  facultyAbbreviation: string | null;
  notes: string | null;
  publishedAt: string;
};

/* ═══════════ Helpers ═══════════ */

function formatDate(date: string) {
  const d = new Date(`${date}T12:00:00`);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, today)) return "Hoje";
  if (sameDay(d, tomorrow)) return "Amanhã";

  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function periodLabel(period: string, shift?: string | null) {
  if (shift === "MORNING") return "Manhã";
  if (shift === "AFTERNOON") return "Tarde";
  return period === "DAY" ? "Diurno" : "Noturno";
}

/* ═══════════ Component ═══════════ */

export default function InternExtrasPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<Record<string, { type: "success" | "error"; text: string }>>({});
  const [tab, setTab] = useState<"available" | "mine">("available");

  const loadOffers = useCallback(async () => {
    setLoading(true);
    try {
      const query = tab === "mine" ? "?all=true" : "";
      const res = await fetch(`/taximetro/api/extra-offers${query}`);
      const json = await res.json();
      if (json.success) setOffers(json.data);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void loadOffers();
  }, [loadOffers]);

  async function claimOffer(id: string) {
    setClaimingId(id);
    setMessages((prev) => ({ ...prev, [id]: { type: "success", text: "" } }));
    try {
      const res = await fetch(`/taximetro/api/extra-offers/${id}`, { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Erro ao pegar plantão");
      setClaimedIds((prev) => new Set([...prev, id]));
      setMessages((prev) => ({ ...prev, [id]: { type: "success", text: "Plantão adicionado à sua escala!" } }));
      // Refresh
      await loadOffers();
    } catch (e) {
      setMessages((prev) => ({ ...prev, [id]: { type: "error", text: e instanceof Error ? e.message : "Erro ao pegar plantão" } }));
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Zap className="h-5 w-5 text-amber-500" strokeWidth={2} />
        <div>
          <h1 className="text-base font-bold text-slate-900">Plantões Extras</h1>
          <p className="text-xs text-slate-500">Primeiro a pegar garante o plantão</p>
        </div>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" strokeWidth={2} />
        <div className="text-xs text-amber-800">
          <strong>Atenção:</strong> Plantões extras <strong>não contabilizam carga horária obrigatória</strong> da rotação. São oportunidades adicionais fora da escala regular.
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit">
        {(["available", "mine"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === t ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
          >
            {t === "available" ? "Disponíveis" : "Meus Extras"}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : offers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-14 text-center">
          <Zap className="mx-auto h-8 w-8 text-slate-200" />
          <p className="mt-2 text-sm font-medium text-slate-400">
            {tab === "available" ? "Nenhum plantão extra disponível no momento." : "Você ainda não pegou nenhum plantão extra."}
          </p>
          <p className="mt-1 text-xs text-slate-400">Novos extras aparecem aqui quando publicados pela coordenação.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {offers.map((offer) => {
            const baseStyle = getBaseStyle(offer.baseType ?? "USA");
            const alreadyClaimed = claimedIds.has(offer.id);
            const msg = messages[offer.id];

            return (
              <div key={offer.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${baseStyle.pill}`}>
                        {offer.baseCode}
                      </span>
                      <span className="text-sm font-bold text-slate-900">
                        {formatDate(offer.date)}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {offer.period === "DAY" ? <span>☀️</span> : <span>🌙</span>} {periodLabel(offer.period, offer.shift)}
                      </span>
                      {offer.facultyAbbreviation && (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                          {offer.facultyAbbreviation}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{offer.baseName}</p>
                    {offer.notes && (
                      <p className="text-xs text-slate-500 italic">{offer.notes}</p>
                    )}
                  </div>

                  {!alreadyClaimed && (
                    <button
                      type="button"
                      disabled={claimingId === offer.id}
                      onClick={() => void claimOffer(offer.id)}
                      className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white hover:bg-amber-600 active:scale-95 disabled:opacity-50"
                    >
                      {claimingId === offer.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4" />
                      )}
                      Pegar
                    </button>
                  )}

                  {alreadyClaimed && (
                    <span className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" /> Garantido
                    </span>
                  )}
                </div>

                {msg && (
                  <p className={`text-xs font-medium ${msg.type === "success" ? "text-emerald-600" : "text-red-600"}`}>
                    {msg.text}
                  </p>
                )}

                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Clock className="h-3 w-3" />
                  Publicado {new Date(offer.publishedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
