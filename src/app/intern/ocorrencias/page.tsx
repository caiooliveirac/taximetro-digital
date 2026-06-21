"use client";

import { useEffect, useState } from "react";
import { ClipboardPlus, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { localDateStr } from "@/lib/utils";

type Assignment = { id: string; baseCode: string; date: string; period: string };

export default function InternOcorrencias() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ assignmentId: "", nickname: "", description: "" });
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const today = localDateStr();
  // Janela retroativa: permite registrar ocorrências de plantões passados (até 90 dias atrás).
  const from = localDateStr(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));

  useEffect(() => {
    fetch(`/taximetro/api/assignments?from=${from}&to=${today}`)
      .then((r) => r.json())
      .then((json) => {
        // Só plantões aos quais o interno já fez checkin (presente em campo) podem receber ocorrências.
        if (json.success) setAssignments(json.data.filter((a: { status: string }) => a.status === "CHECKED_IN" || a.status === "CHECKED_OUT"));
        setLoading(false);
      })
      .catch(() => {
        setMsg({ type: "error", text: "Erro ao carregar plantões." });
        setLoading(false);
      });
  }, []);

  async function submit() {
    if (!form.assignmentId || !form.nickname) return;
    setMsg(null);
    setSubmitting(true);
    try {
      const res = await fetch("/taximetro/api/case-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setMsg({ type: "success", text: "Ocorrência registrada!" });
        setForm({ ...form, nickname: "", description: "" });
      } else {
        setMsg({ type: "error", text: json.error ?? "Erro ao registrar" });
      }
    } catch {
      setMsg({ type: "error", text: "Erro de conexão. Tente novamente." });
    }
    setSubmitting(false);
  }

  if (loading) return <p className="text-sm text-slate-400">Carregando...</p>;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-2xl font-semibold text-slate-900">Ocorrências Clínicas</h1>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-4">
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Plantão</span>
          <select
            value={form.assignmentId}
            onChange={(e) => setForm({ ...form, assignmentId: e.target.value })}
            className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          >
            <option value="">Selecionar...</option>
            {assignments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.baseCode} — {a.date} ({a.period === "DAY" ? "Diurno" : "Noturno"})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Apelido do caso</span>
          <Input
            value={form.nickname}
            onChange={(e) => setForm({ ...form, nickname: e.target.value })}
            className="mt-1"
            placeholder="Ex: PCR, Trauma..."
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Descrição (opcional)</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          />
        </label>
        <Button onClick={submit} disabled={submitting || !form.assignmentId || !form.nickname} className="gap-2">
          <ClipboardPlus className="h-4 w-4" strokeWidth={1.5} /> {submitting ? "Registrando..." : "Registrar"}
        </Button>

        {msg && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${msg.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}>
            {msg.type === "success"
              ? <CheckCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              : <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} />}
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
