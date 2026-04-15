"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Clock, Sun, Moon, KeyRound, Send, LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";
import { usePreceptor } from "./preceptor-context";
import { baseViewIndex } from "@/lib/base-colors";
import { addDaysToDateStr, localDateStr } from "@/lib/utils";

type Assignment = {
  id: string;
  internId: string;
  internName: string;
  baseCode: string;
  baseName: string;
  date: string;
  period: string;
  shift: string;
  status: string;
  facultyAbbr: string;
  checkinStatus: string | null;
};

function shiftLabel(shift: string) {
  if (shift === "MORNING") return "Manhã";
  if (shift === "AFTERNOON") return "Tarde";
  if (shift === "NIGHT") return "Noite";
  return shift;
}

function shiftOrder(shift: string) {
  if (shift === "MORNING") return 0;
  if (shift === "AFTERNOON") return 1;
  if (shift === "NIGHT") return 2;
  return 99;
}

function shiftActionLabel(shift: string) {
  if (shift === "MORNING") return "Check-in manhã";
  if (shift === "AFTERNOON") return "Check-in tarde";
  if (shift === "NIGHT") return "Check-in noite";
  return "Check-in";
}

export default function PreceptorValidar() {
  const { base, shift } = usePreceptor();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [codeObservations, setCodeObservations] = useState("");
  const [facultyFilter, setFacultyFilter] = useState<string>("ALL");
  const [validatingCode, setValidatingCode] = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const today = localDateStr();
  const fromDate = addDaysToDateStr(today, -1);

  async function load() {
    if (!base || !shift) return;
    try {
      const params = new URLSearchParams({ from: fromDate, to: today, baseId: base.id, period: shift });
      const res = await fetch(`/taximetro/api/assignments?${params}`, { headers: { "x-force-role": "PRECEPTOR" } });
      const json = await res.json();
      if (json.success) {
        const sorted = json.data
          .filter((a: Assignment) => a.status !== "CANCELLED")
          .sort((a: Assignment, b: Assignment) => {
            const byBase = baseViewIndex(a.baseCode) - baseViewIndex(b.baseCode);
            if (byBase !== 0) return byBase;

            const byIntern = a.internName.localeCompare(b.internName, "pt-BR");
            if (byIntern !== 0) return byIntern;

            const byShift = shiftOrder(a.shift) - shiftOrder(b.shift);
            if (byShift !== 0) return byShift;

            return a.id.localeCompare(b.id);
          });
        setAssignments(sorted);
      }
    } catch { /* silently retry on next interval */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, [base, shift]);
  useEffect(() => { const iv = setInterval(load, 15000); return () => clearInterval(iv); }, [base, shift]);

  async function validateDirect(assignmentId: string) {
    setMsg(null);
    try {
      const res = await fetch("/taximetro/api/attendance/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-force-role": "PRECEPTOR" },
        body: JSON.stringify({ assignmentId }),
      });
      const json = await res.json();
      if (json.success) {
        setMsg({ type: "success", text: "Presença validada" });
        load();
      }
      else setMsg({ type: "error", text: json.error });
    } catch {
      setMsg({ type: "error", text: "Erro de conexão. Tente novamente." });
    }
  }

  async function validateByCode() {
    if (codeInput.length !== 6) return;
    setValidatingCode(true);
    setMsg(null);
    try {
      const res = await fetch("/taximetro/api/attendance/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-force-role": "PRECEPTOR" },
        body: JSON.stringify({ code: codeInput, observations: codeObservations }),
      });
      const json = await res.json();
      if (json.success) {
        const successText = json.data?.flow === "CHECKOUT"
          ? "Checkout confirmado (código)"
          : "Presença validada (código)";
        setMsg({ type: "success", text: successText });
        setCodeInput("");
        setCodeObservations("");
        load();
      }
      else setMsg({ type: "error", text: json.error });
    } catch {
      setMsg({ type: "error", text: "Erro de conexão. Tente novamente." });
    }
    setValidatingCode(false);
  }

  async function checkoutDirect(assignmentId: string) {
    setCheckingOut(assignmentId);
    setMsg(null);
    try {
      const res = await fetch("/taximetro/api/attendance/checkout", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-force-role": "PRECEPTOR" },
        body: JSON.stringify({ assignmentId }),
      });
      const json = await res.json();
      if (json.success) {
        const total = Array.isArray(json.data?.assignmentIds) ? json.data.assignmentIds.length : 1;
        setMsg({
          type: "success",
          text: total > 1 ? `Checkout confirmado (${total} turnos encerrados)` : "Checkout confirmado",
        });
        load();
      } else {
        setMsg({ type: "error", text: json.error || "Não foi possível confirmar checkout." });
      }
    } catch {
      setMsg({ type: "error", text: "Erro de conexão. Tente novamente." });
    } finally {
      setCheckingOut(null);
    }
  }

  const filteredByName = assignments.filter((a) => !search || a.internName.toLowerCase().includes(search.toLowerCase()));
  const facultyOptions = Array.from(new Set(assignments.map((a) => a.facultyAbbr).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const scoped = filteredByName.filter((a) => {
    if (base?.code !== "CRU" || facultyFilter === "ALL") return true;
    return a.facultyAbbr === facultyFilter;
  });

  const checkinQueue = scoped.filter((a) => a.status === "SCHEDULED");
  const checkoutQueue = scoped.filter((a) =>
    a.status === "CHECKED_IN"
    || (a.checkinStatus === "VALIDATED" && a.status !== "CHECKED_OUT" && a.status !== "CANCELLED"),
  );

  const shiftsByIntern = scoped.reduce<Record<string, Assignment[]>>((acc, item) => {
    if (!acc[item.internId]) acc[item.internId] = [];
    acc[item.internId].push(item);
    return acc;
  }, {});

  for (const internId of Object.keys(shiftsByIntern)) {
    shiftsByIntern[internId].sort((a, b) => shiftOrder(a.shift) - shiftOrder(b.shift));
  }

  function getShiftPosition(item: Assignment) {
    const internShifts = shiftsByIntern[item.internId] ?? [];
    const index = internShifts.findIndex((shiftItem) => shiftItem.id === item.id);
    const position = index >= 0 ? index + 1 : 1;
    return `${position}/${internShifts.length}`;
  }

  function hasDoubleShift(item: Assignment) {
    return (shiftsByIntern[item.internId]?.length ?? 0) > 1;
  }
  const pending = checkinQueue.filter((a) => a.checkinStatus === "PENDING");

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-900">Validar Presença</h1>

      {/* Code validation */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2 mb-2">
          <KeyRound className="h-4 w-4 text-accent-500" strokeWidth={1.5} />
          <h2 className="text-sm font-semibold text-slate-900">Validar por código TOTP</h2>
        </div>
        <p className="text-xs text-slate-400 mb-1">Digite somente os 6 números exibidos na tela do interno.</p>
        <p className="text-xs text-slate-400 mb-3">Sem nome, sem pontos, sem traços e sem texto adicional.</p>
        <div className="flex gap-2">
          <Input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="w-32 text-center font-mono text-lg tracking-widest"
            maxLength={6}
            inputMode="numeric"
            pattern="[0-9]{6}"
            aria-label="Código numérico de seis dígitos"
          />
          <Button onClick={validateByCode} disabled={codeInput.length !== 6 || validatingCode}>
            {validatingCode ? "Validando..." : "Validar"}
          </Button>
        </div>
        <textarea
          value={codeObservations}
          onChange={(e) => setCodeObservations(e.target.value)}
          placeholder="Observações"
          maxLength={2000}
          rows={3}
          className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
        />
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-400">
          <Send className="h-3 w-3" strokeWidth={1.5} /> No Telegram, envie apenas os 6 números no grupo da base
        </p>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-2.5 text-sm ${msg.type === "success" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/10" : "bg-red-50 text-red-700 ring-1 ring-red-600/10"
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

      {checkoutQueue.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-blue-700">
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
          {checkoutQueue.length} checkout(s) pendente(s)
        </div>
      )}

      <Input placeholder="Buscar por nome do interno..." value={search} onChange={(e) => setSearch(e.target.value)} />

      {base?.code === "CRU" && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <label className="mb-1 block text-xs font-medium text-slate-600">Filtrar CRU por faculdade</label>
          <select
            value={facultyFilter}
            onChange={(e) => setFacultyFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-accent-500/30"
          >
            <option value="ALL">Todas as faculdades</option>
            {facultyOptions.map((faculty) => (
              <option key={faculty} value={faculty}>{faculty}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? <TableSkeleton rows={5} cols={5} /> : (
        <>
          {checkoutQueue.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Checkout pendente</h2>
              <div className="space-y-3">
                {checkoutQueue.map((a) => (
                  <div key={`checkout-${a.id}`} className="rounded-xl border border-blue-200 bg-blue-50 p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="whitespace-normal break-words text-sm font-semibold leading-tight text-slate-900">{a.internName}</p>
                          {hasDoubleShift(a) && (
                            <Badge className="bg-indigo-50 text-indigo-700 ring-1 ring-indigo-300/60">Duplo turno</Badge>
                          )}
                          <Badge variant="outline" className="text-[11px]">{shiftLabel(a.shift)} ({getShiftPosition(a)})</Badge>
                        </div>
                        <p className="text-xs text-slate-500">{a.facultyAbbr || "Sem faculdade"}</p>
                      </div>
                      <div className="shrink-0">
                        <Button size="sm" onClick={() => checkoutDirect(a.id)} disabled={checkingOut === a.id} className="gap-1">
                          {checkingOut === a.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                          ) : (
                            <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
                          )}
                          Checkout
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 className="text-sm font-semibold text-slate-900">Validação de check-in</h2>
          <div className="space-y-3 md:hidden">
            {checkinQueue.map((a) => (
              <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="whitespace-normal break-words text-sm font-semibold leading-tight text-slate-900">{a.internName}</p>
                      {hasDoubleShift(a) && (
                        <Badge className="bg-indigo-50 text-indigo-700 ring-1 ring-indigo-300/60">Duplo turno</Badge>
                      )}
                      <Badge variant="outline" className="text-[11px]">{shiftLabel(a.shift)} ({getShiftPosition(a)})</Badge>
                    </div>
                    <p className="text-xs text-slate-500">{a.facultyAbbr || "Sem faculdade"}</p>
                  </div>
                  <div className="shrink-0">
                    <Button
                      size="sm"
                      onClick={() => validateDirect(a.id)}
                    >
                      <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
                      {shiftActionLabel(a.shift)}
                    </Button>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    {a.period === "DAY" ? <Sun className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.5} /> : <Moon className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />}
                    {a.period === "DAY" ? "Diurno" : "Noturno"}
                  </span>
                </div>
              </div>
            ))}
            {checkinQueue.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nenhum interno aguardando check-in na sua base/turno hoje.</p>}
          </div>

          <div className="hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Interno</TableHead>
                <TableHead>Faculdade</TableHead>
                <TableHead>Turno</TableHead>
                <TableHead>Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checkinQueue.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium whitespace-normal break-words">{a.internName}</TableCell>
                  <TableCell className="text-xs">{a.facultyAbbr}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1">
                      {a.period === "DAY" ? <Sun className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.5} /> : <Moon className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />}
                      {a.period === "DAY" ? "Diurno" : "Noturno"} · {shiftLabel(a.shift)}
                      {hasDoubleShift(a) && (
                        <Badge className="bg-indigo-50 text-indigo-700 ring-1 ring-indigo-300/60">Duplo turno</Badge>
                      )}
                      <Badge variant="outline" className="text-[11px]">{getShiftPosition(a)}</Badge>
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => validateDirect(a.id)}
                    >
                      <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
                      {shiftActionLabel(a.shift)}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {checkinQueue.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nenhum interno aguardando check-in na sua base/turno hoje.</p>}
          </div>
        </>
      )}
    </div>
  );
}
