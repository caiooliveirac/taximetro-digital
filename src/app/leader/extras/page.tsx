"use client";

import { useCallback, useEffect, useState } from "react";
import { Zap, Clock, CheckCircle2, Loader2, AlertTriangle, Plus, X } from "lucide-react";
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
  publishedByName?: string;
  publishedAt: string;
  claimedBy?: string | null;
  claimedAt?: string | null;
  cancelledAt?: string | null;
};

type Base = { id: string; code: string; name: string; type: string };

function normalizeDateInput(value: string) {
  const trimmed = value.trim();
  const ymd = trimmed.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (ymd) return ymd;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toISOString().slice(0, 10);
}

/* ═══════════ Helpers ═══════════ */

function formatDate(date: string) {
  const d = new Date(`${date}T12:00:00`);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(d, today)) return "Hoje";
  if (sameDay(d, tomorrow)) return "Amanhã";
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function periodLabel(period: string, shift?: string | null) {
  if (shift === "MORNING") return "Manhã";
  if (shift === "AFTERNOON") return "Tarde";
  return period === "DAY" ? "Diurno" : "Noturno";
}

function offerStatus(o: Offer) {
  if (o.cancelledAt) return "cancelled";
  if (o.claimedBy) return "claimed";
  return "available";
}

/* ═══════════ Component ═══════════ */

export default function LeaderExtrasPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [bases, setBases] = useState<Base[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"available" | "history" | "publish">("available");
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<Record<string, { type: "success" | "error"; text: string }>>({});
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Publish form
  const [pubBaseId, setPubBaseId] = useState("");
  const [pubDate, setPubDate] = useState("");
  const [pubPeriod, setPubPeriod] = useState<"DAY" | "NIGHT">("DAY");
  const [pubNotes, setPubNotes] = useState("");
  const [pubLoading, setPubLoading] = useState(false);
  const [pubMessage, setPubMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadOffers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/taximetro/api/extra-offers?all=true");
      const json = await res.json();
      if (json.success) setOffers(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOffers();
    fetch("/taximetro/api/admin/bases")
      .then((r) => r.json())
      .then((j) => { if (j.success) setBases(j.data); })
      .catch(() => {});
  }, [loadOffers]);

  async function claimOffer(id: string) {
    setClaimingId(id);
    try {
      const res = await fetch(`/taximetro/api/extra-offers/${id}`, { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Erro ao pegar plantão");
      setClaimedIds((prev) => new Set([...prev, id]));
      setMessages((prev) => ({ ...prev, [id]: { type: "success", text: "Plantão adicionado à escala!" } }));
      await loadOffers();
    } catch (e) {
      setMessages((prev) => ({ ...prev, [id]: { type: "error", text: e instanceof Error ? e.message : "Erro" } }));
    } finally {
      setClaimingId(null);
    }
  }

  async function cancelOffer(id: string) {
    setCancellingId(id);
    try {
      const res = await fetch(`/taximetro/api/extra-offers/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Erro ao cancelar");
      setMessages((prev) => ({ ...prev, [id]: { type: "success", text: "Oferta cancelada." } }));
      await loadOffers();
    } catch (e) {
      setMessages((prev) => ({ ...prev, [id]: { type: "error", text: e instanceof Error ? e.message : "Erro" } }));
    } finally {
      setCancellingId(null);
    }
  }

  async function publishOffer() {
    if (!pubBaseId || !pubDate) return;
    setPubLoading(true);
    setPubMessage(null);
    try {
      const normalizedDate = normalizeDateInput(pubDate);
      const res = await fetch("/taximetro/api/extra-offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseId: pubBaseId, date: normalizedDate, period: pubPeriod, notes: pubNotes || null }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Erro ao publicar");
      setPubMessage({ type: "success", text: "Plantão extra publicado!" });
      setPubBaseId(""); setPubDate(""); setPubPeriod("DAY"); setPubNotes("");
      await loadOffers();
    } catch (e) {
      setPubMessage({ type: "error", text: e instanceof Error ? e.message : "Erro ao publicar" });
    } finally {
      setPubLoading(false);
    }
  }

  const available = offers.filter((o) => offerStatus(o) === "available");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <Zap className="h-5 w-5 text-amber-500" strokeWidth={2} />
        <div>
          <h1 className="text-base font-bold text-slate-900">Plantões Extras</h1>
          <p className="text-xs text-slate-500">Publique e gerencie extras da sua faculdade</p>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" strokeWidth={2} />
        <p className="text-xs text-amber-800"><strong>Atenção:</strong> Plantões extras <strong>não contabilizam carga horária obrigatória</strong>.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit">
        {(["available", "history", "publish"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${tab === t ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
          >
            {t === "available" ? `Disponíveis (${available.length})` : t === "history" ? "Histórico" : "Publicar"}
          </button>
        ))}
      </div>

      {/* Publish form */}
      {tab === "publish" && (
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Plus className="h-4 w-4" /> Publicar Plantão Extra</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Base *</label>
              <select
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                value={pubBaseId}
                onChange={(e) => setPubBaseId(e.target.value)}
              >
                <option value="">Selecione a base</option>
                {bases.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Data *</label>
              <input
                type="date"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                value={pubDate}
                onChange={(e) => setPubDate(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Turno *</label>
              <select
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                value={pubPeriod}
                onChange={(e) => setPubPeriod(e.target.value as "DAY" | "NIGHT")}
              >
                <option value="DAY">Diurno</option>
                <option value="NIGHT">Noturno</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Observação</label>
              <input
                type="text"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                placeholder="Ex.: Cobertura de falta"
                value={pubNotes}
                onChange={(e) => setPubNotes(e.target.value)}
              />
            </div>
          </div>
          {pubMessage && (
            <p className={`text-xs font-medium ${pubMessage.type === "success" ? "text-emerald-600" : "text-red-600"}`}>{pubMessage.text}</p>
          )}
          <button
            type="button"
            disabled={pubLoading || !pubBaseId || !pubDate}
            onClick={() => void publishOffer()}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {pubLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Publicar Extra
          </button>
        </div>
      )}

      {/* Offer list */}
      {(tab === "available" || tab === "history") && (
        loading ? (
          <div className="flex justify-center py-12 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (tab === "available" ? available : offers).length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-14 text-center">
            <Zap className="mx-auto h-8 w-8 text-slate-200" />
            <p className="mt-2 text-sm font-medium text-slate-400">Nenhum plantão extra disponível.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(tab === "available" ? available : offers).map((offer) => {
              const baseStyle = getBaseStyle(offer.baseType ?? "USA");
              const status = offerStatus(offer);
              const msg = messages[offer.id];
              const alreadyClaimed = claimedIds.has(offer.id);

              return (
                <div key={offer.id} className={`rounded-2xl border border-slate-100 bg-white p-4 shadow-sm space-y-2 ${status === "cancelled" ? "opacity-50" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${baseStyle.pill}`}>{offer.baseCode}</span>
                        <span className="text-sm font-bold text-slate-900">{formatDate(offer.date)}</span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          {offer.period === "DAY" ? "☀️" : "🌙"} {periodLabel(offer.period, offer.shift)}
                        </span>
                        {status === "claimed" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Preenchido</span>}
                        {status === "cancelled" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Cancelado</span>}
                      </div>
                      {offer.notes && <p className="text-xs text-slate-500 italic">{offer.notes}</p>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {status === "available" && !alreadyClaimed && (
                        <button
                          type="button"
                          disabled={claimingId === offer.id}
                          onClick={() => void claimOffer(offer.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50"
                        >
                          {claimingId === offer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Pegar
                        </button>
                      )}
                      {status === "available" && (
                        <button
                          type="button"
                          disabled={cancellingId === offer.id}
                          onClick={() => void cancelOffer(offer.id)}
                          className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          {cancellingId === offer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      {alreadyClaimed && (
                        <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Garantido
                        </span>
                      )}
                    </div>
                  </div>
                  {msg && <p className={`text-xs font-medium ${msg.type === "success" ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    <Clock className="h-3 w-3" />
                    Publicado {new Date(offer.publishedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
