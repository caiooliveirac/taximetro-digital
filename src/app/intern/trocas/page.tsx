"use client";

import { useEffect, useState } from "react";
import { Send, CheckCircle, AlertCircle, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";

type Assignment = { id: string; baseCode: string; date: string; period: string };
type Base = { id: string; code: string; name: string };
type Request = { id: string; type: string; status: string; createdAt: string };

const TYPE_LABEL: Record<string, string> = { SWAP: "Troca", EXTRA_SHIFT: "Extra", DROP_SHIFT: "Descarte" };
const STATUS_VARIANT: Record<string, "scheduled" | "confirmed" | "absent"> = {
  PENDING: "scheduled",
  APPROVED: "confirmed",
  REJECTED: "absent",
};

export default function InternTrocas() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [bases, setBases] = useState<Base[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"NEW" | "HISTORY">("NEW");
  const [reqType, setReqType] = useState<"DROP_SHIFT" | "EXTRA_SHIFT">("DROP_SHIFT");
  const [assignmentId, setAssignmentId] = useState("");
  const [extraBaseId, setExtraBaseId] = useState("");
  const [extraDate, setExtraDate] = useState("");
  const [extraPeriod, setExtraPeriod] = useState<"DAY" | "NIGHT">("DAY");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const [aRes, bRes, rRes] = await Promise.all([
      fetch(`/taximetro/api/assignments?from=${from}&to=${to}`),
      fetch("/taximetro/api/admin/bases"),
      fetch("/taximetro/api/requests"),
    ]);
    const [aJson, bJson, rJson] = await Promise.all([aRes.json(), bRes.json(), rRes.json()]);
    if (aJson.success) setAssignments(aJson.data.filter((a: { status: string }) => a.status !== "CANCELLED"));
    if (bJson.success) setBases(bJson.data.filter((b: { isActive: boolean }) => b.isActive));
    if (rJson.success) setRequests(rJson.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function submit() {
    setMsg(null);
    setSubmitting(true);
    const body: Record<string, string> = { type: reqType, assignmentId };
    if (reqType === "EXTRA_SHIFT") {
      body.extraBaseId = extraBaseId;
      body.extraDate = extraDate;
      body.extraPeriod = extraPeriod;
    }
    const res = await fetch("/taximetro/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setSubmitting(false);
    if (json.success) { setMsg({ type: "success", text: "Solicitação enviada!" }); load(); }
    else setMsg({ type: "error", text: json.error });
  }

  const selectClass = "mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

  if (loading) return <p className="text-sm text-slate-400">Carregando...</p>;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-2xl font-semibold text-slate-900">Trocas & Solicitações</h1>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        <button
          onClick={() => setTab("NEW")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
            tab === "NEW" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
          }`}
        >
          Nova Solicitação
        </button>
        <button
          onClick={() => setTab("HISTORY")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
            tab === "HISTORY" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
          }`}
        >
          Histórico
        </button>
      </div>

      {tab === "NEW" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Tipo</span>
            <select value={reqType} onChange={(e) => setReqType(e.target.value as "DROP_SHIFT" | "EXTRA_SHIFT")} className={selectClass}>
              <option value="DROP_SHIFT">Descarte de Plantão</option>
              <option value="EXTRA_SHIFT">Plantão Extra</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Plantão de referência</span>
            <select value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)} className={selectClass}>
              <option value="">Selecionar...</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.baseCode} — {a.date} ({a.period === "DAY" ? "Diurno" : "Noturno"})
                </option>
              ))}
            </select>
          </label>
          {reqType === "EXTRA_SHIFT" && (
            <>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Base desejada</span>
                <select value={extraBaseId} onChange={(e) => setExtraBaseId(e.target.value)} className={selectClass}>
                  <option value="">Selecionar...</option>
                  {bases.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">Data</span>
                  <Input type="date" value={extraDate} onChange={(e) => setExtraDate(e.target.value)} className="mt-1" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">Turno</span>
                  <select value={extraPeriod} onChange={(e) => setExtraPeriod(e.target.value as "DAY" | "NIGHT")} className={selectClass}>
                    <option value="DAY">Diurno</option>
                    <option value="NIGHT">Noturno</option>
                  </select>
                </label>
              </div>
            </>
          )}
          <Button onClick={submit} disabled={!assignmentId || submitting} className="gap-2">
            <Send className="h-4 w-4" strokeWidth={1.5} /> {submitting ? "Enviando..." : "Enviar Solicitação"}
          </Button>

          {msg && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              msg.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}>
              {msg.type === "success"
                ? <CheckCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                : <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} />}
              {msg.text}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-slate-900">{TYPE_LABEL[r.type] ?? r.type}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "scheduled"}>
                      {r.status === "PENDING" ? "Pendente" : r.status === "APPROVED" ? "Aprovado" : "Rejeitado"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-500">{new Date(r.createdAt).toLocaleDateString("pt-BR")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {requests.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">Nenhuma solicitação.</p>
          )}
        </div>
      )}
    </div>
  );
}
