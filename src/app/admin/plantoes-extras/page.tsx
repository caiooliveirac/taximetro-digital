"use client";

import { useCallback, useEffect, useState } from "react";
import { Zap, X, BarChart3, Users, Building2, Clock, CheckCircle2, Ban, RefreshCw, Loader2 } from "lucide-react";
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
  facultyName: string | null;
  facultyAbbreviation: string | null;
  notes: string | null;
  publishedBy: string;
  publishedByName: string;
  publishedAt: string;
  claimedBy: string | null;
  claimedAt: string | null;
  assignmentId: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
};

type Analytics = {
  byFaculty: Array<{
    facultyId: string | null;
    facultyName: string | null;
    facultyAbbreviation: string | null;
    total: number;
    claimed: number;
  }>;
  byClaimer: Array<{
    claimedBy: string;
    claimerName: string;
    count: number;
  }>;
  byBase: Array<{
    baseId: string;
    baseCode: string;
    baseName: string;
    baseType: string | null;
    total: number;
    claimed: number;
  }>;
};

/* ═══════════ Helpers ═══════════ */

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function formatDateTime(dt: string) {
  return new Date(dt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function periodLabel(period: string, shift?: string | null) {
  if (shift === "MORNING") return "Manhã";
  if (shift === "AFTERNOON") return "Tarde";
  return period === "DAY" ? "Diurno" : "Noturno";
}

function offerStatus(offer: Offer): "available" | "claimed" | "cancelled" {
  if (offer.cancelledAt) return "cancelled";
  if (offer.claimedBy) return "claimed";
  return "available";
}

/* ═══════════ Component ═══════════ */

export default function AdminExtraOffersPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [tab, setTab] = useState<"available" | "history">("available");
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await fetch("/taximetro/api/extra-offers/analytics");
      const json = await res.json();
      if (json.success) setAnalytics(json.data);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOffers();
    void loadAnalytics();
  }, [loadOffers, loadAnalytics]);

  async function cancelOffer(id: string) {
    setCancellingId(id);
    setMessage(null);
    try {
      const res = await fetch(`/taximetro/api/extra-offers/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Erro ao cancelar");
      setMessage({ type: "success", text: "Oferta cancelada." });
      await loadOffers();
      await loadAnalytics();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Erro ao cancelar" });
    } finally {
      setCancellingId(null);
    }
  }

  const available = offers.filter((o) => offerStatus(o) === "available");
  const history = offers;

  const displayOffers = tab === "available" ? available : history;

  const totalPublished = offers.filter((o) => !o.cancelledAt).length;
  const totalClaimed = offers.filter((o) => o.claimedBy && !o.cancelledAt).length;
  const totalAvailable = offers.filter((o) => offerStatus(o) === "available").length;
  const totalCancelled = offers.filter((o) => offerStatus(o) === "cancelled").length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Zap className="h-5 w-5 text-amber-500" strokeWidth={2} />
          <div>
            <h1 className="text-lg font-bold text-slate-900">Plantões Extras</h1>
            <p className="text-xs text-slate-500">Board de ofertas públicas — primeiro a pegar</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { void loadOffers(); void loadAnalytics(); }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" /> Atualizar
        </button>
      </div>

      {message && (
        <div className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${message.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.text}
          <button type="button" onClick={() => setMessage(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Publicados", value: totalPublished, icon: Zap, color: "text-amber-600 bg-amber-50" },
          { label: "Preenchidos", value: totalClaimed, icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50" },
          { label: "Disponíveis", value: totalAvailable, icon: Clock, color: "text-sky-600 bg-sky-50" },
          { label: "Cancelados", value: totalCancelled, icon: Ban, color: "text-slate-500 bg-slate-100" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className={`inline-flex rounded-xl p-2 ${color.split(" ")[1]}`}>
              <Icon className={`h-4 w-4 ${color.split(" ")[0]}`} strokeWidth={2} />
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Analytics */}
      {!analyticsLoading && analytics && (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* By Faculty */}
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <BarChart3 className="h-3.5 w-3.5" /> Extras por Faculdade
            </div>
            <div className="space-y-2">
              {analytics.byFaculty.length === 0 && <p className="text-xs text-slate-400">Nenhum dado</p>}
              {analytics.byFaculty.map((row) => (
                <div key={row.facultyId ?? "none"} className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-slate-700">{row.facultyAbbreviation ?? "Livre"}</span>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" style={{ width: 64 }}>
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.round((row.claimed / Math.max(row.total, 1)) * 100)}%` }} />
                    </div>
                    <span className="w-8 text-right text-[11px] font-bold text-slate-600">{row.total}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* By Claimer */}
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Users className="h-3.5 w-3.5" /> Quem Mais Pegou
            </div>
            <div className="space-y-2">
              {analytics.byClaimer.length === 0 && <p className="text-xs text-slate-400">Nenhum dado</p>}
              {analytics.byClaimer.slice(0, 8).map((row, i) => (
                <div key={row.claimedBy} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 truncate text-xs font-medium text-slate-700">
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500">{i + 1}</span>
                    {row.claimerName.split(" ").slice(0, 2).join(" ")}
                  </span>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">{row.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* By Base */}
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Building2 className="h-3.5 w-3.5" /> Extras por Base
            </div>
            <div className="space-y-2">
              {analytics.byBase.length === 0 && <p className="text-xs text-slate-400">Nenhum dado</p>}
              {analytics.byBase.map((row) => {
                const style = getBaseStyle(row.baseType ?? "USA");
                return (
                  <div key={row.baseId} className="flex items-center justify-between gap-2">
                    <span className={`inline-flex max-w-[80px] items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${style.pill}`}>
                      {row.baseCode}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" style={{ width: 64 }}>
                        <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.round((row.claimed / Math.max(row.total, 1)) * 100)}%` }} />
                      </div>
                      <span className="w-8 text-right text-[11px] font-bold text-slate-600">{row.total}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit">
        {(["available", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === t ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
          >
            {t === "available" ? `Disponíveis (${available.length})` : `Histórico (${offers.length})`}
          </button>
        ))}
      </div>

      {/* Offer list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : displayOffers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
          <Zap className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-400">
            {tab === "available" ? "Nenhum plantão extra disponível no momento." : "Nenhuma oferta encontrada."}
          </p>
          <p className="mt-1 text-xs text-slate-400">Para publicar, clique no ⚡ nas vagas da grade ou escala.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayOffers.map((offer) => {
            const status = offerStatus(offer);
            const baseStyle = getBaseStyle(offer.baseType ?? "USA");
            return (
              <div
                key={offer.id}
                className={`flex items-start gap-4 rounded-2xl border bg-white px-5 py-4 shadow-sm ${status === "cancelled" ? "opacity-50" : ""}`}
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${baseStyle.pill}`}>
                      {offer.baseCode}
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {formatDate(offer.date)} · {periodLabel(offer.period, offer.shift)}
                    </span>
                    {offer.facultyAbbreviation && (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {offer.facultyAbbreviation}
                      </span>
                    )}
                    {status === "available" && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Disponível</span>
                    )}
                    {status === "claimed" && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Preenchido</span>
                    )}
                    {status === "cancelled" && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Cancelado</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    Publicado por <span className="font-medium text-slate-700">{offer.publishedByName}</span> em {formatDateTime(offer.publishedAt)}
                    {offer.claimedAt && offer.claimedBy && (
                      <> · Preenchido em {formatDateTime(offer.claimedAt)}</>
                    )}
                  </div>
                  {offer.notes && (
                    <p className="text-xs text-slate-500 italic">{offer.notes}</p>
                  )}
                </div>
                {status === "available" && (
                  <button
                    type="button"
                    disabled={cancellingId === offer.id}
                    onClick={() => void cancelOffer(offer.id)}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  >
                    {cancellingId === offer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Cancelar
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
