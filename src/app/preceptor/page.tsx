"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, History, KeyRound, LogIn, LogOut, Moon, Sun, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/table-skeleton";
import { usePreceptor } from "./preceptor-context";
import { DateNavigator, PendenciasDoDia, STRIP_DAYS, fetchPendencias, longDate } from "./pendencias-por-data";
import { InternAttendanceCard } from "./intern-attendance-card";
import { baseViewIndex, getBaseStyleByCode } from "@/lib/base-colors";
import { addDaysToDateStr, cn, localDateStr, operationalDateStr } from "@/lib/utils";

type Assignment = {
  id: string;
  internId: string;
  internName: string;
  internPhone: string | null;
  baseCode: string;
  baseName: string;
  date: string;
  period: string;
  shift: string;
  status: string;
  facultyAbbr: string;
  checkinStatus: string | null;
};

function shiftOrder(shift: string) {
  if (shift === "MORNING") return 0;
  if (shift === "AFTERNOON") return 1;
  if (shift === "NIGHT") return 2;
  return 99;
}

type BoxTone = "previous" | "waiting" | "inShift" | "absent" | "done";

const BOX_TONES: Record<BoxTone, { border: string; header: string; badge: string; icon: typeof Clock }> = {
  previous: { border: "border-amber-300", header: "bg-amber-100 text-amber-900", badge: "bg-amber-600 text-white", icon: History },
  waiting: { border: "border-slate-300", header: "bg-slate-100 text-slate-800", badge: "bg-slate-700 text-white", icon: LogIn },
  inShift: { border: "border-blue-300", header: "bg-blue-50 text-blue-900", badge: "bg-blue-600 text-white", icon: LogOut },
  absent: { border: "border-red-200", header: "bg-red-50 text-red-800", badge: "bg-red-600 text-white", icon: UserX },
  done: { border: "border-emerald-200", header: "bg-emerald-50 text-emerald-800", badge: "bg-emerald-600 text-white", icon: CheckCircle2 },
};

function dayMonthLabel(dateStr: string) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).replace(".", "");
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

  const today = localDateStr();
  const fromDate = addDaysToDateStr(today, -1);

  // null = plantão atual (hoje e ontem na base declarada); data = volta ao passado
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayCounts, setDayCounts] = useState<Record<string, { checkout: number; checkin: number }>>({});

  async function loadDayCounts() {
    try {
      const rows = await fetchPendencias(addDaysToDateStr(today, -(STRIP_DAYS - 1)), addDaysToDateStr(today, -1));
      const counts: Record<string, { checkout: number; checkin: number }> = {};
      for (const r of rows) {
        const c = (counts[r.date] ??= { checkout: 0, checkin: 0 });
        if (r.kind === "CHECKOUT") c.checkout += 1;
        else c.checkin += 1;
      }
      setDayCounts(counts);
    } catch { /* a faixa fica sem números; a navegação continua */ }
  }

  useEffect(() => { loadDayCounts(); }, [today]);

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

  const filteredByName = assignments.filter((a) => !search || a.internName.toLowerCase().includes(search.toLowerCase()));
  const facultyOptions = Array.from(new Set(assignments.map((a) => a.facultyAbbr).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const scoped = filteredByName.filter((a) => {
    if (base?.code !== "CRU" || facultyFilter === "ALL") return true;
    return a.facultyAbbr === facultyFilter;
  });

  // A fila mantém o plantão em tela depois da falta/abono: sem isso, um clique
  // errado some da lista e o preceptor não tem como voltar atrás.
  const checkinQueue = scoped.filter((a) => ["SCHEDULED", "CONFIRMED", "ABSENT", "EXCUSED"].includes(a.status));
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

  const canCheckout = (a: Assignment) => a.status === "CHECKED_IN"
    || (a.checkinStatus === "VALIDATED" && a.status !== "CHECKED_OUT" && a.status !== "CANCELLED");
  // Cada interno numa caixa só, pela situação: o plantão anterior que ficou
  // pendente vem separado no topo; no atual, quem nem entrou, quem está em
  // plantão (falta checkout), faltas e, por último, quem já fechou.
  const operationalToday = operationalDateStr();
  const byName = (a: Assignment, b: Assignment) => a.internName.localeCompare(b.internName, "pt-BR") || shiftOrder(a.shift) - shiftOrder(b.shift);
  const previous = scoped.filter((a) => a.date < operationalToday && a.status !== "CHECKED_OUT").sort(byName);
  const current = scoped.filter((a) => a.date >= operationalToday);
  const boxes: Array<{ key: string; tone: BoxTone; title: string; items: Assignment[] }> = [
    { key: "ontem", tone: "previous", title: `Pendente do plantão anterior${previous[0] ? ` · ${dayMonthLabel(previous[0].date)}` : ""}`, items: previous },
    { key: "sem-checkin", tone: "waiting", title: "Sem check-in", items: current.filter((a) => !canCheckout(a) && ["SCHEDULED", "CONFIRMED"].includes(a.status)).sort(byName) },
    { key: "em-plantao", tone: "inShift", title: "Em plantão · falta checkout", items: current.filter(canCheckout).sort(byName) },
    { key: "faltas", tone: "absent", title: "Faltas", items: current.filter((a) => !canCheckout(a) && ["ABSENT", "EXCUSED"].includes(a.status)).sort(byName) },
    { key: "fechados", tone: "done", title: "Plantão encerrado", items: current.filter((a) => a.status === "CHECKED_OUT").sort(byName) },
  ];
  const total = boxes.reduce((sum, box) => sum + box.items.length, 0);
  const baseStyle = getBaseStyleByCode(base?.code);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {selectedDate ? "Voltando no tempo" : "Hoje"}
        </p>
        <h1 className="text-3xl font-bold capitalize leading-tight text-slate-900">{longDate(selectedDate ?? today)}</h1>
      </div>

      <DateNavigator today={today} selected={selectedDate} counts={dayCounts} onSelect={setSelectedDate} />

      {selectedDate ? (
        <PendenciasDoDia date={selectedDate} onChanged={loadDayCounts} />
      ) : (
      <>

      <div className="rounded-xl border border-accent-200 bg-accent-50/60 p-3">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase leading-snug tracking-wide text-accent-700">
          <KeyRound className="h-4 w-4 shrink-0" strokeWidth={2} />
          É aqui que você digita o código que o interno te mostra
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => { if (e.key === "Enter") validateByCode(); }}
            placeholder="000000"
            className="w-32 bg-white text-center font-mono text-lg tracking-widest"
            maxLength={6}
            inputMode="numeric"
            pattern="[0-9]{6}"
            aria-label="Código numérico de seis dígitos"
          />
          <Button onClick={validateByCode} disabled={codeInput.length !== 6 || validatingCode}>
            {validatingCode ? "Validando..." : "Validar"}
          </Button>
        </div>
        {codeInput.length === 6 && (
          <Input
            value={codeObservations}
            onChange={(e) => setCodeObservations(e.target.value)}
            placeholder="Observação (opcional)"
            maxLength={2000}
            className="mt-2 bg-white text-sm"
          />
        )}
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-2.5 text-sm ${msg.type === "success" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/10" : "bg-red-50 text-red-700 ring-1 ring-red-600/10"
          }`}>
          {msg.text}
        </div>
      )}

      {(pending.length > 0 || checkoutQueue.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {pending.length > 0 && (
            <span className="flex items-center gap-1.5 text-amber-700">
              <Clock className="h-3.5 w-3.5" strokeWidth={1.5} /> {pending.length} aguardando validação
            </span>
          )}
          {checkoutQueue.length > 0 && (
            <span className="flex items-center gap-1.5 text-blue-700">
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} /> {checkoutQueue.length} checkout(s) pendente(s)
            </span>
          )}
        </div>
      )}

      {assignments.length > 6 && (
        <Input placeholder="Buscar interno..." value={search} onChange={(e) => setSearch(e.target.value)} />
      )}

      {base?.code === "CRU" && facultyOptions.length > 1 && (
        <select
          value={facultyFilter}
          onChange={(e) => setFacultyFilter(e.target.value)}
          aria-label="Filtrar CRU por faculdade"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-accent-500/30"
        >
          <option value="ALL">Todas as faculdades</option>
          {facultyOptions.map((faculty) => (
            <option key={faculty} value={faculty}>{faculty}</option>
          ))}
        </select>
      )}

      {loading ? <TableSkeleton rows={5} cols={3} /> : (
        <div className="space-y-3">
          <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2", baseStyle.bg, baseStyle.border)}>
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", baseStyle.dot)} />
            <span className={cn("text-sm font-bold", baseStyle.text)}>{base?.code}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{base?.name}</span>
            <span className={cn("flex items-center gap-1 text-[11px] font-semibold", shift === "DAY" ? "text-amber-700" : "text-indigo-700")}>
              {shift === "DAY" ? <Sun className="h-3.5 w-3.5" strokeWidth={1.5} /> : <Moon className="h-3.5 w-3.5" strokeWidth={1.5} />}
              {shift === "DAY" ? "Diurno" : "Noturno"}
            </span>
            <span className={cn("rounded-full px-2 text-[11px] font-semibold", baseStyle.badge)}>{total}</span>
          </div>

          {total === 0 && (
            <p className="rounded-xl border border-dashed border-slate-200 bg-white py-8 text-center text-sm text-slate-400">Nenhum interno escalado na sua base/turno hoje.</p>
          )}

          {boxes.filter((box) => box.items.length > 0).map((box) => {
            const tone = BOX_TONES[box.tone];
            return (
              <section key={box.key} className={cn("overflow-hidden rounded-xl border bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]", tone.border)}>
                <header className={cn("flex items-center gap-2 px-3 py-2", tone.header)}>
                  <tone.icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                  <h2 className="min-w-0 flex-1 truncate text-sm font-bold">{box.title}</h2>
                  <span className={cn("rounded-full px-2 text-[11px] font-bold", tone.badge)}>{box.items.length}</span>
                </header>
                <ul className="divide-y divide-slate-100">
                  {box.items.map((a) => (
                    <InternAttendanceCard
                      key={a.id}
                      assignment={a}
                      canCheckout={canCheckout(a)}
                      checkinMode="validate"
                      badge={hasDoubleShift(a) ? (
                        <Badge className="bg-indigo-50 text-indigo-700 ring-1 ring-indigo-300/60">Duplo turno {getShiftPosition(a)}</Badge>
                      ) : null}
                      onUpdated={load}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      </>
      )}
    </div>
  );
}
