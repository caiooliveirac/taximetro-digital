"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, CheckCircle, AlertCircle, ShieldCheck, Sun, Moon, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBaseStyle } from "@/lib/base-colors";

type SwapRow = {
  id: string;
  requesterName: string;
  baseCode: string | null;
  baseName: string | null;
  baseType: string | null;
  assignmentDate: string | null;
  assignmentPeriod: string | null;
  targetInternName: string | null;
  targetBaseCode: string | null;
  targetBaseName: string | null;
  targetAssignmentDate: string | null;
  targetAssignmentPeriod: string | null;
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function PeriodIcon({ period }: { period: string | null }) {
  if (!period) return null;
  return period === "DAY"
    ? <Sun className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.5} />
    : <Moon className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />;
}

function ShiftBadge({ code, baseType, date, period }: {
  code: string | null; baseType: string | null; date: string | null; period: string | null;
}) {
  const bs = getBaseStyle(baseType ?? undefined);
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${bs.dot}`} />
      <div>
        <p className="text-sm font-medium text-slate-900">{code ?? "—"}</p>
        <p className="text-xs text-slate-500 flex items-center gap-1">{fmtDate(date)} <PeriodIcon period={period} /></p>
      </div>
    </div>
  );
}

export default function PreceptorTrocas() {
  const [rows, setRows] = useState<SwapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/taximetro/api/requests?scope=awaiting-auth", { headers: { "x-force-role": "PRECEPTOR" } });
      const json = await res.json();
      if (json.success) setRows(json.data);
    } catch {
      setMsg({ type: "error", text: "Erro ao carregar trocas." });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const iv = setInterval(load, 15000); return () => clearInterval(iv); }, [load]);

  async function act(id: string, action: "authorize" | "reject") {
    setBusy(id); setMsg(null);
    try {
      const res = await fetch("/taximetro/api/requests/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-force-role": "PRECEPTOR" },
        body: JSON.stringify({ id, action, notes: notes[id]?.trim() || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        setMsg({ type: "success", text: action === "authorize" ? "Troca autorizada." : "Troca recusada." });
        load();
      } else {
        setMsg({ type: "error", text: json.error || "Erro." });
      }
    } catch {
      setMsg({ type: "error", text: "Erro de conexão." });
    }
    setBusy(null);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <ArrowLeftRight className="h-6 w-6 text-accent-500" strokeWidth={1.5} />
          Autorizar Trocas
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Trocas de <strong>CRU</strong> acordadas entre internos aguardando sua autorização. Ao autorizar, os plantões são trocados e o registro fica nas observações de cada plantão.
        </p>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${msg.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {msg.type === "success" ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {msg.text}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white py-12 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.5} />
          <p className="mt-2 text-sm text-slate-400">Nenhuma troca aguardando autorização.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-900">{r.requesterName}</p>
                  <ShiftBadge code={r.baseCode} baseType={r.baseType} date={r.assignmentDate} period={r.assignmentPeriod} />
                </div>
                <ArrowLeftRight className="h-5 w-5 text-slate-300" strokeWidth={1.5} />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-900">{r.targetInternName ?? "—"}</p>
                  <ShiftBadge code={r.targetBaseCode} baseType={null} date={r.targetAssignmentDate} period={r.targetAssignmentPeriod} />
                </div>
              </div>

              <input
                type="text"
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                placeholder="Observação (opcional)"
                maxLength={2000}
                className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              />

              <div className="flex gap-2">
                <Button size="sm" onClick={() => act(r.id, "authorize")} disabled={busy === r.id}
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                  {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                  Autorizar
                </Button>
                <Button size="sm" variant="outline" onClick={() => act(r.id, "reject")} disabled={busy === r.id} className="gap-1.5">
                  <X className="h-3.5 w-3.5" /> Recusar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
