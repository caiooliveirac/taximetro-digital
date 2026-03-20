"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Clock, Sun, Moon, KeyRound, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";
import { usePreceptor } from "./preceptor-context";
import { baseViewIndex } from "@/lib/base-colors";

type Assignment = {
  id: string;
  internId: string;
  internName: string;
  baseCode: string;
  baseName: string;
  date: string;
  period: string;
  status: string;
};

export default function PreceptorValidar() {
  const { base, shift } = usePreceptor();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [validatingCode, setValidatingCode] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  async function load() {
    if (!base || !shift) return;
    const params = new URLSearchParams({ from: today, to: today, baseId: base.id, period: shift });
    const res = await fetch(`/taximetro/api/assignments?${params}`);
    const json = await res.json();
    if (json.success) {
      const sorted = json.data
        .filter((a: Assignment) => a.status !== "CANCELLED")
        .sort((a: Assignment, b: Assignment) => baseViewIndex(a.baseCode) - baseViewIndex(b.baseCode));
      setAssignments(sorted);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [base, shift]);
  useEffect(() => { const iv = setInterval(load, 15000); return () => clearInterval(iv); }, [base, shift]);

  async function validateDirect(assignmentId: string) {
    setMsg(null);
    const res = await fetch("/taximetro/api/attendance/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId }),
    });
    const json = await res.json();
    if (json.success) { setMsg({ type: "success", text: "Presença validada" }); load(); }
    else setMsg({ type: "error", text: json.error });
  }

  async function validateByCode() {
    if (codeInput.length !== 6) return;
    setValidatingCode(true);
    setMsg(null);
    const res = await fetch("/taximetro/api/attendance/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: codeInput }),
    });
    const json = await res.json();
    if (json.success) { setMsg({ type: "success", text: "Presença validada (código)" }); setCodeInput(""); load(); }
    else setMsg({ type: "error", text: json.error });
    setValidatingCode(false);
  }

  const filtered = assignments.filter((a) => !search || a.internName.toLowerCase().includes(search.toLowerCase()));
  const pending = assignments.filter((a) => a.status === "SCHEDULED");

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-900">Validar Presença</h1>

      {/* Code validation */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2 mb-2">
          <KeyRound className="h-4 w-4 text-accent-500" strokeWidth={1.5} />
          <h2 className="text-sm font-semibold text-slate-900">Validar por código TOTP</h2>
        </div>
        <p className="text-xs text-slate-400 mb-3">Digite o código de 6 dígitos exibido na tela do interno</p>
        <div className="flex gap-2">
          <Input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="w-32 text-center font-mono text-lg tracking-widest"
            maxLength={6}
            inputMode="numeric"
          />
          <Button onClick={validateByCode} disabled={codeInput.length !== 6 || validatingCode}>
            {validatingCode ? "Validando..." : "Validar"}
          </Button>
        </div>
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-400">
          <Send className="h-3 w-3" strokeWidth={1.5} /> Ou valide pelo Telegram no grupo da base
        </p>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-2.5 text-sm ${
          msg.type === "success" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/10" : "bg-red-50 text-red-700 ring-1 ring-red-600/10"
        }`}>
          {msg.text}
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-amber-700">
          <Clock className="h-3.5 w-3.5" strokeWidth={1.5} />
          {pending.length} interno(s) aguardando validação
        </div>
      )}

      <Input placeholder="Buscar por nome do interno..." value={search} onChange={(e) => setSearch(e.target.value)} />

      {loading ? <TableSkeleton rows={5} cols={5} /> : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Interno</TableHead>
                <TableHead>Base</TableHead>
                <TableHead>Turno</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.internName}</TableCell>
                  <TableCell>{a.baseCode}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1">
                      {a.period === "DAY" ? <Sun className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.5} /> : <Moon className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />}
                      {a.period === "DAY" ? "Diurno" : "Noturno"}
                    </span>
                  </TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell>
                    {a.status === "SCHEDULED" ? (
                      <Button size="sm" variant="default" onClick={() => validateDirect(a.id)}>
                        <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
                        Confirmar
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nenhum interno escalado para sua base/turno hoje.</p>}
        </div>
      )}
    </div>
  );
}
