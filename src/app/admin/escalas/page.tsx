"use client";

import { useEffect, useState, Fragment } from "react";
import { Sun, Moon, Plus, Loader2, Trash2, X, Save } from "lucide-react";
import { getFacultyStyle, baseViewIndex } from "@/lib/base-colors";

type Rule = {
  id: string; baseId: string; baseCode: string; baseName: string;
  dayOfWeek: string; period: string; facultyId: string; facultyAbbr: string;
  capacity: number; isActive: boolean;
};
type Base = { id: string; code: string; name: string; type: string; isActive?: boolean };
type Faculty = { id: string; abbreviation: string; name: string };

type EditState = {
  baseId: string; baseCode: string; dayOfWeek: string; period: string;
  facultyId: string; capacity: number; ruleId?: string;
};

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const DAY_LABELS: Record<string, string> = { MON: "Seg", TUE: "Ter", WED: "Qua", THU: "Qui", FRI: "Sex", SAT: "Sáb", SUN: "Dom" };
const DAY_SHORT: Record<string, string> = { MON: "S", TUE: "T", WED: "Q", THU: "Q", FRI: "S", SAT: "S", SUN: "D" };

export default function AdminEscalas() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [bases, setBases] = useState<Base[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterBase, setFilterBase] = useState("");
  const [hlFaculty, setHlFaculty] = useState<string | null>(null);
  const [hlPeriod, setHlPeriod] = useState<"DAY" | "NIGHT" | null>(null);

  async function load() {
    try {
      const [rRes, bRes, fRes] = await Promise.all([
        fetch("/taximetro/api/admin/rules").then(r => r.json()),
        fetch("/taximetro/api/admin/bases").then(r => r.json()),
        fetch("/taximetro/api/admin/faculties").then(r => r.json()),
      ]);
      if (rRes.success) setRules(rRes.data.filter((r: Rule) => r.isActive));
      if (bRes.success) setBases(bRes.data.filter((b: Base) => b.isActive !== false));
      if (fRes.success) setFaculties(fRes.data);
    } catch {
      setError("Erro ao carregar grade de escalas.");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function getRules(baseId: string, day: string, period: string) {
    return rules.filter(r => r.baseId === baseId && r.dayOfWeek === day && r.period === period);
  }

  function openNew(baseId: string, baseCode: string, day: string, period: string) {
    setEditing({ baseId, baseCode, dayOfWeek: day, period, facultyId: "", capacity: 1 });
    setError("");
  }

  function openEdit(r: Rule) {
    setEditing({ baseId: r.baseId, baseCode: r.baseCode, dayOfWeek: r.dayOfWeek, period: r.period, facultyId: r.facultyId, capacity: r.capacity, ruleId: r.id });
    setError("");
  }

  async function saveRule() {
    if (!editing || !editing.facultyId) return;
    setSaving(true); setError("");
    const body = editing.ruleId
      ? { id: editing.ruleId, facultyId: editing.facultyId, capacity: editing.capacity }
      : { baseId: editing.baseId, dayOfWeek: editing.dayOfWeek, period: editing.period, facultyId: editing.facultyId, capacity: editing.capacity };
    const res = await fetch("/taximetro/api/admin/rules", {
      method: editing.ruleId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setSaving(false);
    if (!json.success) { setError(json.error); return; }
    setEditing(null);
    load();
  }

  async function removeRule(id: string) {
    try {
      await fetch(`/taximetro/api/admin/rules?id=${id}`, { method: "DELETE" });
      setEditing(null);
      load();
    } catch {
      setError("Erro ao remover regra.");
    }
  }

  const sortedBases = (filterBase ? bases.filter(b => b.id === filterBase) : bases)
    .sort((a, b) => baseViewIndex(a.code) - baseViewIndex(b.code));

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-slate-400">
      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando grade...
    </div>
  );

  const totalSlots = rules.reduce((s, r) => s + r.capacity, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Grade de Escalas</h1>
          <p className="text-sm text-slate-500">{rules.length} regras · {totalSlots} vagas/semana · {bases.length} bases</p>
        </div>
        <select
          value={filterBase}
          onChange={e => setFilterBase(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
        >
          <option value="">Todas as bases</option>
          {bases.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
        </select>
      </div>

      {/* Faculty legend — clickable for highlight */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {faculties.map(f => {
          const st = getFacultyStyle(f.abbreviation);
          const active = hlFaculty === f.abbreviation;
          return (
            <button
              key={f.id}
              onClick={() => setHlFaculty(active ? null : f.abbreviation)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-all cursor-pointer ${st.pill} ${active ? "ring-2 ring-offset-1 scale-105" : hlFaculty ? "opacity-30" : ""}`}
            >
              <span className={`h-2 w-2 rounded-full ${st.dot}`} />
              {f.abbreviation}
            </button>
          );
        })}
        <span className="text-slate-300 mx-1">|</span>
        <button
          onClick={() => setHlPeriod(hlPeriod === "DAY" ? null : "DAY")}
          className={`inline-flex items-center gap-1 cursor-pointer transition-all ${hlPeriod === "DAY" ? "font-bold scale-105" : hlPeriod ? "opacity-30" : "text-slate-500"}`}
        >
          <Sun className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.5} /> Diurno
        </button>
        <button
          onClick={() => setHlPeriod(hlPeriod === "NIGHT" ? null : "NIGHT")}
          className={`inline-flex items-center gap-1 cursor-pointer transition-all ${hlPeriod === "NIGHT" ? "font-bold scale-105" : hlPeriod ? "opacity-30" : "text-slate-500"}`}
        >
          <Moon className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} /> Noturno
        </button>
      </div>

      {/* Edit card */}
      {editing && (
        <div className="rounded-xl border border-accent-200 bg-accent-50/30 p-3 space-y-2 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              {editing.ruleId ? "Editar" : "Nova Regra"} — {editing.baseCode} · {DAY_LABELS[editing.dayOfWeek]} · {editing.period === "DAY" ? "☀️ Diurno" : "🌙 Noturno"}
            </h2>
            <button onClick={() => setEditing(null)} className="rounded-md p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Faculdade</span>
              <select
                value={editing.facultyId}
                onChange={e => setEditing({ ...editing, facultyId: e.target.value })}
                className="mt-0.5 block w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              >
                <option value="">Selecionar...</option>
                {faculties.map(f => <option key={f.id} value={f.id}>{f.abbreviation}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Vagas</span>
              <input
                type="number" min={1} max={10}
                value={editing.capacity}
                onChange={e => setEditing({ ...editing, capacity: +e.target.value })}
                className="mt-0.5 block w-16 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              />
            </label>
            <button
              onClick={saveRule}
              disabled={saving || !editing.facultyId}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Salvar
            </button>
            {editing.ruleId && (
              <button
                onClick={() => removeRule(editing.ruleId!)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 ring-1 ring-red-600/20 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remover
              </button>
            )}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}

      {/* CSS Grid */}
      <div
        className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "72px repeat(7, minmax(76px, 1fr))",
            minWidth: "620px",
          }}
        >
          {/* Corner cell */}
          <div className="sticky left-0 z-20 bg-slate-50 border-b border-r border-slate-200 p-2 flex items-center justify-center">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Base</span>
          </div>
          {/* Day headers */}
          {DAYS.map(day => (
            <div key={day} className="bg-slate-50 border-b border-slate-200 px-1 py-2 text-center">
              <span className="text-xs font-semibold text-slate-700 hidden sm:inline">{DAY_LABELS[day]}</span>
              <span className="text-xs font-semibold text-slate-700 sm:hidden">{DAY_SHORT[day]}</span>
            </div>
          ))}

          {/* Base rows */}
          {sortedBases.map(base => (
            <Fragment key={base.id}>
              {/* Base label — sticky */}
              <div className="sticky left-0 z-10 bg-white border-b border-r border-slate-100 px-1.5 py-2 flex flex-col items-center justify-center">
                <span className="text-[11px] font-bold text-slate-900 leading-tight">{base.code}</span>
                <span className="text-[9px] text-slate-400 truncate max-w-[64px] leading-tight">{base.name}</span>
              </div>

              {/* Day cells */}
              {DAYS.map(day => {
                const dayR = getRules(base.id, day, "DAY");
                const nightR = getRules(base.id, day, "NIGHT");
                const isEditing = editing?.baseId === base.id && editing?.dayOfWeek === day;

                return (
                  <div
                    key={`${base.id}-${day}`}
                    className={`border-b border-l border-slate-100 p-1 min-h-[56px] flex flex-col gap-0.5 justify-center transition-colors ${isEditing ? "bg-accent-50/40" : "hover:bg-slate-50/50"}`}
                  >
                    {/* DAY period */}
                    <div className={`flex flex-wrap items-center gap-0.5 transition-opacity ${hlPeriod === "NIGHT" ? "opacity-15" : ""}`}>
                      {dayR.map(r => {
                        const st = getFacultyStyle(r.facultyAbbr);
                        const dim = hlFaculty && hlFaculty !== r.facultyAbbr;
                        return (
                          <button
                            key={r.id}
                            onClick={() => openEdit(r)}
                            title={`${r.facultyAbbr} ×${r.capacity} — Clique para editar`}
                            className={`inline-flex items-center gap-0.5 rounded px-1 py-px text-[10px] font-semibold ${st.pill} hover:opacity-75 transition-all cursor-pointer ${dim ? "opacity-15" : ""}`}
                          >
                            <Sun className="h-2.5 w-2.5 text-amber-500 shrink-0" strokeWidth={2} />
                            <span className="truncate">{r.facultyAbbr}</span>
                            {r.capacity > 1 && <span className="opacity-50">×{r.capacity}</span>}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => openNew(base.id, base.code, day, "DAY")}
                        title="Adicionar turno diurno"
                        className="inline-flex items-center rounded border border-dashed border-amber-300/50 px-0.5 py-px text-amber-400 hover:bg-amber-50 hover:border-amber-400 transition-colors"
                      >
                        <Sun className="h-2.5 w-2.5" strokeWidth={2} />
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                    </div>

                    {/* NIGHT period */}
                    <div className={`flex flex-wrap items-center gap-0.5 transition-opacity ${hlPeriod === "DAY" ? "opacity-15" : ""}`}>
                      {nightR.map(r => {
                        const st = getFacultyStyle(r.facultyAbbr);
                        const dim = hlFaculty && hlFaculty !== r.facultyAbbr;
                        return (
                          <button
                            key={r.id}
                            onClick={() => openEdit(r)}
                            title={`${r.facultyAbbr} ×${r.capacity} — Clique para editar`}
                            className={`inline-flex items-center gap-0.5 rounded px-1 py-px text-[10px] font-semibold ${st.pill} hover:opacity-75 transition-all cursor-pointer ${dim ? "opacity-15" : ""}`}
                          >
                            <Moon className="h-2.5 w-2.5 text-indigo-500 shrink-0" strokeWidth={2} />
                            <span className="truncate">{r.facultyAbbr}</span>
                            {r.capacity > 1 && <span className="opacity-50">×{r.capacity}</span>}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => openNew(base.id, base.code, day, "NIGHT")}
                        title="Adicionar turno noturno"
                        className="inline-flex items-center rounded border border-dashed border-indigo-300/50 px-0.5 py-px text-indigo-400 hover:bg-indigo-50 hover:border-indigo-400 transition-colors"
                      >
                        <Moon className="h-2.5 w-2.5" strokeWidth={2} />
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {sortedBases.length === 0 && (
        <p className="text-center text-sm text-slate-400 py-8">Nenhuma base encontrada.</p>
      )}
    </div>
  );
}
