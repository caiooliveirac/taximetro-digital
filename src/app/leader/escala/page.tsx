"use client";

import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import {
  Search, Filter, ChevronLeft, ChevronRight,
  Dices, X, RotateCcw, UserX,
} from "lucide-react";
import { getBaseStyle, getPeriodStyle } from "@/lib/base-colors";

/* ────────── Types ────────── */

type Intern = { id: string; name: string };
type InternRole = { id: string; name: string; userActive: boolean; roleActive: boolean };
type Base = { id: string; code: string; name: string; type: string };
type Assignment = {
  id: string; internId: string; internName: string;
  baseId: string; baseCode: string; baseName: string; baseType: string;
  date: string; period: string; status: string;
};
type Slot = {
  ruleId: string; baseId: string; baseCode: string; baseName: string; baseType: string;
  dayOfWeek: string; period: string; capacity: number; filled: number; available: number;
  nextDate: string;
};

const DOW_IDX: Record<string, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };
const DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const BASE_ORDER = ["SM01", "PM04", "PM40", "CN10", "PR03", "CC70", "BR60", "CB02", "IT30", "CZ50", "BR05", "PP20"];

const STATUS_RING: Record<string, string> = {
  CHECKED_IN: "ring-2 ring-emerald-400",
  CHECKED_OUT: "ring-2 ring-blue-400",
  CONFIRMED: "ring-2 ring-emerald-400",
  ABSENT: "ring-2 ring-red-400",
  SCHEDULED: "",
};

/* ────────── Component ────────── */

export default function LeaderEscala() {
  /* ── Data ── */
  const [interns, setInterns] = useState<Intern[]>([]);
  const [bases, setBases] = useState<Base[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── Week ── */
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  });

  const weekDates = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart + "T12:00:00");
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    }),
    [weekStart],
  );

  /* ── Filters ── */
  const [searchUSA, setSearchUSA] = useState("");
  const [searchIntern, setSearchIntern] = useState("");
  const [filterBase, setFilterBase] = useState("");
  const [filterPeriod, setFilterPeriod] = useState<"" | "DAY" | "NIGHT">("");
  const [searchBase, setSearchBase] = useState("");

  /* ── Lottery modal ── */
  const [showLottery, setShowLottery] = useState(false);
  const [lotteryInterns, setLotteryInterns] = useState<InternRole[]>([]);
  const [lotterySelected, setLotterySelected] = useState<Set<string>>(new Set());
  const [lotteryExcluded, setLotteryExcluded] = useState<Set<string>>(new Set());
  const [lotteryLoading, setLotteryLoading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);
  const [lotteryMsg, setLotteryMsg] = useState("");

  /* ── Load data ── */
  const load = useCallback(async () => {
    const from = weekDates[0];
    const to = weekDates[6];
    const [uRes, bRes, aRes, sRes] = await Promise.all([
      fetch("/taximetro/api/admin/users"),
      fetch("/taximetro/api/admin/bases"),
      fetch(`/taximetro/api/assignments?from=${from}&to=${to}`),
      fetch("/taximetro/api/slots/available"),
    ]);
    const [uJson, bJson, aJson, sJson] = await Promise.all([uRes.json(), bRes.json(), aRes.json(), sRes.json()]);
    if (uJson.success) setInterns(uJson.data.filter((u: { role: string }) => u.role === "INTERN"));
    if (bJson.success) setBases(bJson.data.filter((b: { isActive: boolean }) => b.isActive));
    if (aJson.success) setAssignments(aJson.data);
    if (sJson.success) setSlots(sJson.data);
    setLoading(false);
  }, [weekDates]);

  useEffect(() => { load(); }, [load]);

  /* ── Derived ── */
  const usaBases = useMemo(() =>
    [...bases.filter((b) => b.type === "USA")].sort((a, b) => {
      const ai = BASE_ORDER.indexOf(a.code);
      const bi = BASE_ORDER.indexOf(b.code);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    }),
    [bases],
  );
  const cruBase = useMemo(() => bases.find((b) => b.type === "CENTRAL"), [bases]);

  /* ── Vacancy matrix from slots ── */
  const vacancyByBaseDay = useMemo(() => {
    const m = new Map<string, { DAY: { cap: number; fill: number }; NIGHT: { cap: number; fill: number } }>();
    for (const s of slots) {
      const dayIdx = DOW_IDX[s.dayOfWeek];
      if (dayIdx === undefined) continue;
      const dateStr = weekDates[dayIdx];
      if (!dateStr) continue;
      const key = `${s.baseId}|${dateStr}`;
      if (!m.has(key)) m.set(key, { DAY: { cap: 0, fill: 0 }, NIGHT: { cap: 0, fill: 0 } });
      const entry = m.get(key)!;
      const p = s.period as "DAY" | "NIGHT";
      entry[p].cap += s.capacity;
      entry[p].fill += Number(s.filled);
    }
    return m;
  }, [slots, weekDates]);

  const assignmentsByBaseDate = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments) {
      if (a.status === "CANCELLED") continue;
      const key = `${a.baseId}|${a.date}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    return m;
  }, [assignments]);

  const assignmentsByInternDate = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments) {
      if (a.status === "CANCELLED") continue;
      const key = `${a.internId}|${a.date}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    return m;
  }, [assignments]);

  /* ── Week nav ── */
  function shiftWeek(dir: number) {
    const d = new Date(weekStart + "T12:00:00");
    d.setDate(d.getDate() + dir * 7);
    setWeekStart(d.toISOString().slice(0, 10));
  }

  /* ── Lottery handlers ── */
  async function openLottery() {
    setShowLottery(true);
    setLotteryLoading(true);
    setLotteryMsg("");
    setConfirmRemove(null);
    const res = await fetch("/taximetro/api/leader/interns");
    const json = await res.json();
    if (json.success) {
      setLotteryInterns(json.data);
      const sel = new Set<string>();
      (json.data as InternRole[]).forEach((i) => { if (i.roleActive) sel.add(i.id); });
      setLotterySelected(sel);
      setLotteryExcluded(new Set());
    }
    setLotteryLoading(false);
  }

  function toggleLotteryIntern(id: string) {
    setLotterySelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleRemoveIntern(id: string, permanent: boolean) {
    if (permanent) {
      await fetch("/taximetro/api/leader/interns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: id, action: "deactivate" }),
      });
      setLotteryInterns((prev) =>
        prev.map((i) => (i.id === id ? { ...i, roleActive: false } : i)),
      );
    } else {
      setLotteryExcluded((prev) => new Set(prev).add(id));
    }
    setLotterySelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setConfirmRemove(null);
  }

  async function handleReactivateIntern(id: string) {
    await fetch("/taximetro/api/leader/interns", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: id, action: "reactivate" }),
    });
    setLotteryInterns((prev) =>
      prev.map((i) => (i.id === id ? { ...i, roleActive: true } : i)),
    );
    setLotterySelected((prev) => new Set(prev).add(id));
  }

  async function runLottery() {
    setLotteryLoading(true);
    setLotteryMsg("");
    const ids = [...lotterySelected].filter((id) => !lotteryExcluded.has(id));
    const res = await fetch("/taximetro/api/leader/lottery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart, internIds: ids }),
    });
    const json = await res.json();
    if (json.success) {
      setLotteryMsg(`✅ ${json.data.total} alocações criadas!`);
      await load();
    } else {
      setLotteryMsg(`❌ ${json.error}`);
    }
    setLotteryLoading(false);
  }

  /* ── Grid 3 filtered interns ── */
  const filteredInterns = useMemo(() => {
    return interns.filter((intern) => {
      if (searchIntern && !intern.name.toLowerCase().includes(searchIntern.toLowerCase())) return false;
      if (filterBase || filterPeriod || searchBase) {
        const has = assignments.some((a) => {
          if (a.internId !== intern.id || a.status === "CANCELLED") return false;
          if (filterBase && a.baseId !== filterBase) return false;
          if (filterPeriod && a.period !== filterPeriod) return false;
          if (searchBase && !a.baseCode.toLowerCase().includes(searchBase.toLowerCase())) return false;
          return true;
        });
        if (!has) return false;
      }
      return true;
    });
  }, [interns, searchIntern, filterBase, filterPeriod, searchBase, assignments]);

  const today = new Date().toISOString().slice(0, 10);
  const selectedCount = [...lotterySelected].filter((id) => !lotteryExcluded.has(id)).length;

  if (loading) return <p className="p-8 text-slate-400">Carregando...</p>;

  return (
    <div className="space-y-8">
      {/* ═══════════ Header ═══════════ */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Montar Escala</h1>
        <div className="flex-1" />
        <button
          onClick={openLottery}
          className="relative rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 px-7 py-3.5 text-base font-extrabold text-white shadow-[0_6px_20px_rgba(16,185,129,0.4)] transition hover:shadow-[0_8px_30px_rgba(16,185,129,0.5)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[0_2px_8px_rgba(16,185,129,0.3)]"
        >
          <span className="flex items-center gap-2">
            <Dices className="h-6 w-6" /> SORTEAR
          </span>
        </button>
      </div>

      {/* Week navigation */}
      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={() => shiftWeek(-1)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" /> Anterior
        </button>
        <span className="text-sm font-semibold text-slate-700">
          Semana de {new Date(weekStart + "T12:00:00").toLocaleDateString("pt-BR")}
        </span>
        <button onClick={() => shiftWeek(1)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 flex items-center gap-1">
          Próxima <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* ═══════════ Grid 1: USA Base × Dia ═══════════ */}
      <section className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-red-700 flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
            USA — Base × Dia
          </h2>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar interno..."
              value={searchUSA}
              onChange={(e) => setSearchUSA(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-sm w-52 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <div
            className="min-w-[800px]"
            style={{ display: "grid", gridTemplateColumns: "110px repeat(7, 1fr)" }}
          >
            {/* Header row */}
            <div className="sticky left-0 z-10 bg-slate-50 border-b border-r border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500">
              Base
            </div>
            {weekDates.map((d, i) => (
              <div
                key={d}
                className={`border-b border-slate-200 px-2 py-2 text-center text-xs font-semibold ${d === today ? "bg-red-50/50 text-red-700" : "text-slate-500 bg-slate-50"}`}
              >
                {DAY_LABELS[i]}<br /><span className="font-normal">{d.slice(5)}</span>
              </div>
            ))}

            {/* Base rows */}
            {usaBases.map((base) => (
              <Fragment key={base.id}>
                <div className="sticky left-0 z-10 bg-white border-b border-r border-slate-100 px-3 py-2 text-sm font-bold text-slate-900 flex items-center">
                  {base.code}
                </div>
                {weekDates.map((d) => {
                  const all = assignmentsByBaseDate.get(`${base.id}|${d}`) ?? [];
                  const filtered = searchUSA
                    ? all.filter((a) => a.internName.toLowerCase().includes(searchUSA.toLowerCase()))
                    : all;
                  return (
                    <div
                      key={`${base.id}|${d}`}
                      className={`border-b border-slate-100 px-1 py-1 min-h-[44px] ${d === today ? "bg-red-50/20" : ""}`}
                    >
                      {filtered.map((a) => {
                        const ps = getPeriodStyle(a.period);
                        const ring = STATUS_RING[a.status] ?? "";
                        return (
                          <div
                            key={a.id}
                            className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium mb-0.5 flex items-center gap-1 ${ps.bg} ${ps.text} ${ring}`}
                            title={`${a.internName} · ${ps.label} · ${a.status}`}
                          >
                            <span>{ps.emoji}</span>
                            <span className="truncate">{a.internName.split(" ").slice(0, 2).join(" ")}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ Vagas — Resumo de ocupação ═══════════ */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-amber-700 flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-amber-500" />
          Vagas — Ocupação por Base
        </h2>
        <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white shadow-sm">
          <div className="min-w-[800px]" style={{ display: "grid", gridTemplateColumns: "110px repeat(7, 1fr)" }}>
            <div className="sticky left-0 z-10 bg-amber-50/50 border-b border-r border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700">Base</div>
            {weekDates.map((d, i) => (
              <div key={d} className={`border-b border-amber-200 px-2 py-2 text-center text-xs font-semibold ${d === today ? "bg-amber-50/60 text-amber-800" : "text-slate-500 bg-amber-50/30"}`}>
                {DAY_LABELS[i]}<br /><span className="font-normal">{d.slice(5)}</span>
              </div>
            ))}
            {usaBases.map((base) => (
              <Fragment key={`v-${base.id}`}>
                <div className="sticky left-0 z-10 bg-white border-b border-r border-amber-100 px-3 py-1.5 text-sm font-bold text-slate-900">{base.code}</div>
                {weekDates.map((d) => {
                  const v = vacancyByBaseDay.get(`${base.id}|${d}`);
                  if (!v) return <div key={`v-${base.id}|${d}`} className="border-b border-amber-50 px-1 py-1 min-h-[38px]" />;
                  const dayOpen = v.DAY.cap - v.DAY.fill;
                  const nightOpen = v.NIGHT.cap - v.NIGHT.fill;
                  const total = dayOpen + nightOpen;
                  return (
                    <div key={`v-${base.id}|${d}`} className={`border-b border-amber-50 px-1 py-1 min-h-[38px] flex flex-col gap-0.5 justify-center ${d === today ? "bg-amber-50/20" : ""}`}>
                      {v.DAY.cap > 0 && (
                        <div className={`rounded px-1 py-0.5 text-[10px] font-medium flex items-center gap-1 ${dayOpen > 0 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                          ☀️ {v.DAY.fill}/{v.DAY.cap}{dayOpen > 0 && <span className="text-amber-500 font-bold">({dayOpen})</span>}
                        </div>
                      )}
                      {v.NIGHT.cap > 0 && (
                        <div className={`rounded px-1 py-0.5 text-[10px] font-medium flex items-center gap-1 ${nightOpen > 0 ? "bg-indigo-50 text-indigo-700" : "bg-emerald-50 text-emerald-700"}`}>
                          🌙 {v.NIGHT.fill}/{v.NIGHT.cap}{nightOpen > 0 && <span className="text-indigo-500 font-bold">({nightOpen})</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ Grid 2: CRU — Central ═══════════ */}
      {cruBase && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-violet-700 flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-violet-500" />
            CRU — Central de Regulação
          </h2>

          <div className="overflow-x-auto rounded-xl border border-violet-200 bg-white shadow-sm">
            <div
              className="min-w-[600px]"
              style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}
            >
              {weekDates.map((d, i) => (
                <div
                  key={d}
                  className={`border-b border-violet-100 px-2 py-2 text-center text-xs font-semibold ${d === today ? "bg-violet-50/60 text-violet-700" : "text-slate-500 bg-violet-50/30"}`}
                >
                  {DAY_LABELS[i]}<br /><span className="font-normal">{d.slice(5)}</span>
                </div>
              ))}
              {weekDates.map((d) => {
                const cell = assignmentsByBaseDate.get(`${cruBase.id}|${d}`) ?? [];
                return (
                  <div
                    key={d}
                    className={`px-2 py-2 min-h-[56px] border-r last:border-r-0 border-violet-50 ${d === today ? "bg-violet-50/20" : ""}`}
                  >
                    {cell.length === 0 && <span className="text-xs text-slate-300 italic">—</span>}
                    {cell.map((a) => {
                      const ps = getPeriodStyle(a.period);
                      return (
                        <div
                          key={a.id}
                          className="rounded-md bg-violet-50 text-violet-700 px-2 py-1 text-xs font-medium mb-1 flex items-center gap-1"
                        >
                          <span>{ps.emoji}</span>
                          <span className="truncate">{a.internName}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ═══════════ Grid 3: Interno × Dia ═══════════ */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">👤 Interno × Dia</h2>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <Filter className="h-4 w-4 text-slate-400" />
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text" placeholder="Buscar interno..."
              value={searchIntern} onChange={(e) => setSearchIntern(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-sm w-44 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
            />
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text" placeholder="Buscar base..."
              value={searchBase} onChange={(e) => setSearchBase(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-sm w-36 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
            />
          </div>
          <select
            value={filterBase} onChange={(e) => setFilterBase(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          >
            <option value="">Todas as bases</option>
            {bases.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
          <select
            value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value as "" | "DAY" | "NIGHT")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          >
            <option value="">Todos os turnos</option>
            <option value="DAY">☀️ Diurno</option>
            <option value="NIGHT">🌙 Noturno</option>
          </select>
          <span className="text-xs text-slate-400 ml-auto">{filteredInterns.length} internos</span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-slate-500">
                <th className="py-2.5 pl-4 pr-4 font-medium sticky left-0 bg-slate-50 z-10">Interno</th>
                {weekDates.map((d, i) => (
                  <th key={d} className={`py-2.5 px-2 text-center min-w-[110px] font-medium ${d === today ? "bg-accent-50/40" : ""}`}>
                    {DAY_LABELS[i]}<br /><span className="text-xs font-normal">{d.slice(5)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredInterns.map((intern) => (
                <tr key={intern.id} className="border-b border-slate-100 hover:bg-slate-50/30 transition-colors">
                  <td className="py-2 pl-4 pr-4 font-medium whitespace-nowrap text-slate-900 sticky left-0 bg-white z-10">
                    {intern.name}
                  </td>
                  {weekDates.map((d) => {
                    let dayA = assignmentsByInternDate.get(`${intern.id}|${d}`) ?? [];
                    dayA = dayA.filter((a) => {
                      if (filterBase && a.baseId !== filterBase) return false;
                      if (filterPeriod && a.period !== filterPeriod) return false;
                      if (searchBase && !a.baseCode.toLowerCase().includes(searchBase.toLowerCase())) return false;
                      return true;
                    });
                    return (
                      <td key={d} className={`py-1.5 px-1.5 text-center ${d === today ? "bg-accent-50/40" : ""}`}>
                        {dayA.map((a) => {
                          const bs = getBaseStyle(a.baseType);
                          const ps = getPeriodStyle(a.period);
                          const ring = STATUS_RING[a.status] ?? "";
                          return (
                            <div
                              key={a.id}
                              className={`rounded-md px-1.5 py-1 text-[11px] font-medium mb-0.5 flex items-center justify-center gap-1 ${bs.pill} ${ring}`}
                              title={`${a.baseCode} — ${a.baseName} · ${ps.label}`}
                            >
                              <span className={`inline-block h-1.5 w-1.5 rounded-full ${bs.dot}`} />
                              {a.baseCode}
                              <span className="text-[10px]">{ps.emoji}</span>
                            </div>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {filteredInterns.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">Nenhum interno encontrado</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ═══════════ Lottery Modal ═══════════ */}
      {showLottery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-4 text-white flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Dices className="h-5 w-5" /> Sortear Internos
                </h2>
                <p className="text-sm text-emerald-100">
                  Semana de {new Date(weekStart + "T12:00:00").toLocaleDateString("pt-BR")}
                </p>
              </div>
              <button onClick={() => setShowLottery(false)} className="rounded-lg p-1.5 hover:bg-white/20 transition">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Intern list */}
            <div className="px-6 py-4 max-h-[400px] overflow-y-auto space-y-1">
              {lotteryLoading ? (
                <p className="text-slate-400 text-sm py-4 text-center">Carregando internos...</p>
              ) : (
                <>
                  {lotteryInterns.filter((i) => i.roleActive).map((intern) => {
                    const selected = lotterySelected.has(intern.id);
                    const excluded = lotteryExcluded.has(intern.id);
                    return (
                      <div
                        key={intern.id}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 transition ${
                          excluded ? "bg-slate-50 opacity-50" : selected ? "bg-emerald-50/70" : "bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected && !excluded}
                          onChange={() => toggleLotteryIntern(intern.id)}
                          disabled={excluded}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className={`flex-1 text-sm font-medium ${excluded ? "line-through text-slate-400" : "text-slate-800"}`}>
                          {intern.name}
                        </span>
                        {excluded ? (
                          <span className="text-[11px] text-slate-400 italic">excluído</span>
                        ) : (
                          <button
                            onClick={() => setConfirmRemove({ id: intern.id, name: intern.name })}
                            className="rounded p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                            title="Remover"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {/* Inactive interns */}
                  {lotteryInterns.some((i) => !i.roleActive) && (
                    <>
                      <div className="border-t border-slate-200 mt-3 pt-3">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Inativos</p>
                      </div>
                      {lotteryInterns.filter((i) => !i.roleActive).map((intern) => (
                        <div key={intern.id} className="flex items-center gap-3 rounded-lg px-3 py-2 bg-slate-50/50 opacity-60">
                          <UserX className="h-4 w-4 text-slate-400" />
                          <span className="flex-1 text-sm text-slate-500 line-through">{intern.name}</span>
                          <button
                            onClick={() => handleReactivateIntern(intern.id)}
                            className="rounded px-2 py-1 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition flex items-center gap-1"
                            title="Restaurar"
                          >
                            <RotateCcw className="h-3 w-3" />Restaurar
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Inline confirmation */}
            {confirmRemove && (
              <div className="mx-6 mb-2 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <p className="text-sm text-amber-800 font-medium">
                  Remover <strong>{confirmRemove.name}</strong>:
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleRemoveIntern(confirmRemove.id, true)}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition"
                  >
                    Remover da faculdade
                  </button>
                  <button
                    onClick={() => handleRemoveIntern(confirmRemove.id, false)}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition"
                  >
                    Apenas deste sorteio
                  </button>
                  <button
                    onClick={() => setConfirmRemove(null)}
                    className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-300 transition"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-slate-200 px-6 py-4 bg-slate-50/50">
              <div className="flex items-center justify-between mb-3 text-xs text-slate-500">
                <span>Selecionados: <strong className="text-slate-700">{selectedCount}</strong></span>
              </div>
              {lotteryMsg && <p className="text-sm mb-3">{lotteryMsg}</p>}
              <button
                onClick={runLottery}
                disabled={lotteryLoading || selectedCount === 0}
                className="w-full rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 py-3.5 text-base font-extrabold text-white shadow-[0_6px_20px_rgba(16,185,129,0.35)] hover:shadow-[0_8px_30px_rgba(16,185,129,0.5)] transition disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
              >
                <Dices className="h-5 w-5" /> SORTEAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}