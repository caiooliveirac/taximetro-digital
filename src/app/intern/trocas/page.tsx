"use client";

import { useEffect, useState } from "react";
import { Send, CheckCircle, AlertCircle, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";

type Assignment = { id: string; baseCode: string; date: string; period: string; internId: string; internName?: string };
type Base = { id: string; code: string; name: string };
type Intern = { id: string; name: string };
type Request = { id: string; type: string; status: string; createdAt: string };

const TYPE_LABEL: Record<string, string> = { SWAP: "Troca", EXTRA_SHIFT: "Extra", DROP_SHIFT: "Descarte" };
const STATUS_VARIANT: Record<string, "scheduled" | "confirmed" | "absent"> = {
  PENDING: "scheduled",
  APPROVED: "confirmed",
  COMPLETED: "confirmed",
  REJECTED: "absent",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  APPROVED: "Aprovado",
  COMPLETED: "Concluído",
  REJECTED: "Rejeitado",
  ESCALATED: "Escalado",
};

export default function InternTrocas() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [bases, setBases] = useState<Base[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [facultyInterns, setFacultyInterns] = useState<Intern[]>([]);
  const [targetAssignments, setTargetAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"NEW" | "HISTORY">("NEW");
  const [reqType, setReqType] = useState<"DROP_SHIFT" | "EXTRA_SHIFT" | "SWAP">("DROP_SHIFT");
  const [assignmentId, setAssignmentId] = useState("");
  const [extraBaseId, setExtraBaseId] = useState("");
  const [extraDate, setExtraDate] = useState("");
  const [extraPeriod, setExtraPeriod] = useState<"DAY" | "NIGHT">("DAY");
  const [targetInternId, setTargetInternId] = useState("");
  const [targetAssignmentId, setTargetAssignmentId] = useState("");
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

  // Load faculty colleagues for SWAP
  async function loadFacultyInterns() {
    const res = await fetch("/taximetro/api/slots/available");
    const json = await res.json();
    // We piggyback off leader/interns if available, or use compliance
    const compRes = await fetch("/taximetro/api/compliance");
    const compJson = await compRes.json();
    if (compJson.success && Array.isArray(compJson.data)) {
      // compliance returns all interns in the same faculty for an intern
      const interns: Intern[] = compJson.data
        .filter((c: { userId: string; name: string }) => c.userId && c.name)
        .map((c: { userId: string; name: string }) => ({ id: c.userId, name: c.name }));
      setFacultyInterns(interns);
    }
  }

  // Load target intern's assignments
  async function loadTargetAssignments(internId: string) {
    if (!internId) { setTargetAssignments([]); return; }
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    // Use admin endpoint with internId filter (coordinator flow) or
    // the assignments endpoint. We need to see target's assignments.
    const res = await fetch(`/taximetro/api/assignments?from=${from}&to=${to}&internId=${internId}`);
    const json = await res.json();
    if (json.success) {
      setTargetAssignments(
        json.data.filter((a: { status: string }) => a.status === "SCHEDULED" || a.status === "CONFIRMED")
      );
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (reqType === "SWAP") loadFacultyInterns();
  }, [reqType]);

  useEffect(() => {
    if (reqType === "SWAP" && targetInternId) loadTargetAssignments(targetInternId);
    else setTargetAssignments([]);
  }, [reqType, targetInternId]);

  async function submit() {
    setMsg(null);
    setSubmitting(true);
    const body: Record<string, string> = { type: reqType, assignmentId };
    if (reqType === "EXTRA_SHIFT") {
      body.extraBaseId = extraBaseId;
      body.extraDate = extraDate;
      body.extraPeriod = extraPeriod;
    }
    if (reqType === "SWAP") {
      body.targetInternId = targetInternId;
      body.targetAssignmentId = targetAssignmentId;
    }
    const res = await fetch("/taximetro/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setSubmitting(false);
    if (json.success) {
      setMsg({ type: "success", text: "Solicitação enviada!" });
      setAssignmentId(""); setTargetInternId(""); setTargetAssignmentId("");
      load();
    } else {
      setMsg({ type: "error", text: json.error });
    }
  }

  const selectClass = "mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

  const canSubmit = (() => {
    if (!assignmentId) return false;
    if (reqType === "EXTRA_SHIFT" && (!extraBaseId || !extraDate)) return false;
    if (reqType === "SWAP" && (!targetInternId || !targetAssignmentId)) return false;
    return true;
  })();

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
            <select value={reqType} onChange={(e) => { setReqType(e.target.value as typeof reqType); setAssignmentId(""); setTargetInternId(""); setTargetAssignmentId(""); }} className={selectClass}>
              <option value="DROP_SHIFT">Descarte de Plantão</option>
              <option value="EXTRA_SHIFT">Plantão Extra</option>
              <option value="SWAP">Troca de Plantão</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-500">
              {reqType === "SWAP" ? "Seu plantão para troca" : "Plantão de referência"}
            </span>
            <select value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)} className={selectClass}>
              <option value="">Selecionar...</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.baseCode} — {a.date} ({a.period === "DAY" ? "Diurno" : "Noturno"})
                </option>
              ))}
            </select>
          </label>

          {reqType === "SWAP" && (
            <>
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                <ArrowLeftRight className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                Selecione o colega e qual plantão dele você deseja assumir em troca.
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Colega para troca</span>
                <select value={targetInternId} onChange={(e) => { setTargetInternId(e.target.value); setTargetAssignmentId(""); }} className={selectClass}>
                  <option value="">Selecionar colega...</option>
                  {facultyInterns.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </label>
              {targetInternId && (
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">Plantão do colega</span>
                  <select value={targetAssignmentId} onChange={(e) => setTargetAssignmentId(e.target.value)} className={selectClass}>
                    <option value="">Selecionar plantão...</option>
                    {targetAssignments.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.baseCode} — {a.date} ({a.period === "DAY" ? "Diurno" : "Noturno"})
                      </option>
                    ))}
                  </select>
                  {targetAssignments.length === 0 && (
                    <p className="mt-1 text-xs text-slate-400">Nenhum plantão futuro disponível para este colega.</p>
                  )}
                </label>
              )}
            </>
          )}

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

          <Button onClick={submit} disabled={!canSubmit || submitting} className="gap-2">
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
                      {STATUS_LABEL[r.status] ?? r.status}
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
