"use client";

import { useEffect, useState, Fragment } from "react";
import { Sun, Moon, Plus, Loader2, Trash2, X, Save } from "lucide-react";
import { getFacultyStyle, baseViewIndex } from "@/lib/base-colors";

type Rule = {
    id: string; baseId: string; baseCode: string; baseName: string;
    dayOfWeek: string; period: string; facultyId: string; facultyAbbr: string;
    capacity: number; isActive: boolean; isExtraShift: boolean;
};
type Base = { id: string; code: string; name: string; type: string; isActive?: boolean };
type Faculty = { id: string; abbreviation: string; name: string };

type EditState = {
    baseId: string; baseCode: string; dayOfWeek: string; period: string;
    facultyId: string; capacity: number; ruleId?: string; isExtraShift: boolean;
};

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const DAY_LABELS: Record<string, string> = { MON: "Seg", TUE: "Ter", WED: "Qua", THU: "Qui", FRI: "Sex", SAT: "Sáb", SUN: "Dom" };
const DAY_SHORT: Record<string, string> = { MON: "S", TUE: "T", WED: "Q", THU: "Q", FRI: "S", SAT: "S", SUN: "D" };

export function AdminRulesBoard() {
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
                fetch("/taximetro/api/admin/rules").then((r) => r.json()),
                fetch("/taximetro/api/admin/bases").then((r) => r.json()),
                fetch("/taximetro/api/admin/faculties").then((r) => r.json()),
            ]);
            if (rRes.success) setRules(rRes.data.filter((rule: Rule) => rule.isActive));
            if (bRes.success) setBases(bRes.data.filter((base: Base) => base.isActive !== false));
            if (fRes.success) setFaculties(fRes.data);
        } catch {
            setError("Erro ao carregar grade de escalas.");
        }
        setLoading(false);
    }

    useEffect(() => { load(); }, []);

    function getRules(baseId: string, day: string, period: string) {
        return rules.filter((rule) => rule.baseId === baseId && rule.dayOfWeek === day && rule.period === period);
    }

    function openNew(baseId: string, baseCode: string, day: string, period: string) {
        setEditing({ baseId, baseCode, dayOfWeek: day, period, facultyId: "", capacity: 1, isExtraShift: false });
        setError("");
    }

    function openEdit(rule: Rule) {
        setEditing({ baseId: rule.baseId, baseCode: rule.baseCode, dayOfWeek: rule.dayOfWeek, period: rule.period, facultyId: rule.facultyId, capacity: rule.capacity, ruleId: rule.id, isExtraShift: rule.isExtraShift });
        setError("");
    }

    async function saveRule() {
        if (!editing || !editing.facultyId) return;
        setSaving(true);
        setError("");
        const body = editing.ruleId
            ? { id: editing.ruleId, facultyId: editing.facultyId, capacity: editing.capacity, isExtraShift: editing.isExtraShift }
            : { baseId: editing.baseId, dayOfWeek: editing.dayOfWeek, period: editing.period, facultyId: editing.facultyId, capacity: editing.capacity, isExtraShift: editing.isExtraShift };
        try {
            const res = await fetch("/taximetro/api/admin/rules", {
                method: editing.ruleId ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const json = await res.json();
            if (!json.success) {
                setError(json.error || "Erro ao salvar regra.");
                return;
            }
            setEditing(null);
            await load();
        } catch {
            setError("Erro ao salvar regra.");
        } finally {
            setSaving(false);
        }
    }

    async function removeRule(id: string) {
        try {
            const res = await fetch(`/taximetro/api/admin/rules?id=${id}`, { method: "DELETE" });
            const json = await res.json();
            if (!json.success) {
                setError(json.error || "Erro ao remover regra.");
                return;
            }
            setEditing(null);
            await load();
        } catch {
            setError("Erro ao remover regra.");
        }
    }

    const sortedBases = (filterBase ? bases.filter((base) => base.id === filterBase) : bases)
        .sort((left, right) => baseViewIndex(left.code) - baseViewIndex(right.code));

    // Chips de regra de um turno (diurno/noturno) + botão de adicionar.
    // `large` = variante da visão vertical de base única (alvos de toque maiores).
    function renderPeriodChips(base: Base, day: string, period: "DAY" | "NIGHT", large = false) {
        const periodRules = getRules(base.id, day, period);
        const Icon = period === "DAY" ? Sun : Moon;
        const iconColor = period === "DAY" ? "text-amber-500" : "text-indigo-500";
        const addCls = period === "DAY"
            ? "border-amber-300/50 text-amber-400 hover:border-amber-400 hover:bg-amber-50"
            : "border-indigo-300/50 text-indigo-400 hover:border-indigo-400 hover:bg-indigo-50";
        const dimmed = hlPeriod && hlPeriod !== period;
        const chipSize = large ? "gap-1 rounded-md px-1.5 py-1 text-[11px]" : "gap-0.5 rounded px-1 py-px text-[10px]";
        const iconSize = large ? "h-3 w-3" : "h-2.5 w-2.5";

        return (
            <div className={`flex flex-wrap items-center ${large ? "gap-1" : "gap-0.5"} transition-opacity ${dimmed ? "opacity-15" : ""}`}>
                {periodRules.map((rule) => {
                    const style = getFacultyStyle(rule.facultyAbbr);
                    const dim = hlFaculty && hlFaculty !== rule.facultyAbbr;
                    return (
                        <button
                            key={rule.id}
                            onClick={() => openEdit(rule)}
                            title={`${rule.facultyAbbr} ×${rule.capacity}${rule.isExtraShift ? " (Extra)" : ""} — Clique para editar`}
                            className={`inline-flex cursor-pointer items-center font-semibold transition-all hover:opacity-75 ${chipSize} ${style.pill} ${dim ? "opacity-15" : ""} ${rule.isExtraShift ? "ring-1 ring-amber-400" : ""}`}
                        >
                            <Icon className={`${iconSize} shrink-0 ${iconColor}`} strokeWidth={2} />
                            <span className="truncate">{rule.facultyAbbr}</span>
                            {rule.capacity > 1 && <span className="opacity-50">×{rule.capacity}</span>}
                            {rule.isExtraShift && <span className="ml-0.5 rounded bg-amber-500 px-0.5 text-[8px] text-white leading-tight">EX</span>}
                        </button>
                    );
                })}
                <button
                    onClick={() => openNew(base.id, base.code, day, period)}
                    title={period === "DAY" ? "Adicionar turno diurno" : "Adicionar turno noturno"}
                    className={`inline-flex items-center rounded border border-dashed transition-colors ${large ? "px-1.5 py-1" : "px-0.5 py-px"} ${addCls}`}
                >
                    <Icon className={iconSize} strokeWidth={2} />
                    <Plus className={iconSize} />
                </button>
            </div>
        );
    }

    const singleBase = filterBase ? sortedBases[0] ?? null : null;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-slate-400">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando grade...
            </div>
        );
    }

    const totalSlots = rules.reduce((sum, rule) => sum + rule.capacity, 0);

    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-2xl font-bold text-slate-900">Grade</h1>
                <p className="text-sm text-slate-500">Gerencie regras de vagas por faculdade sem carregar a visão operacional preenchida.</p>
            </div>

            <div>
                <h2 className="text-2xl font-bold text-slate-900">Regras da Semana</h2>
                <p className="text-sm text-slate-500">{rules.length} regras · {totalSlots} vagas/semana · {bases.length} bases</p>
            </div>

            {/* Filtro de base como chips visíveis (sem dropdown) — 1 toque para focar a base */}
            <div className="overflow-x-auto">
                <div className="flex min-w-max items-center gap-2 pb-0.5 text-xs">
                    <button
                        type="button"
                        onClick={() => setFilterBase("")}
                        className={`inline-flex items-center rounded-full px-2.5 py-1 font-medium transition-all ${!filterBase ? "bg-slate-900 text-white shadow-[0_10px_18px_rgba(15,23,42,0.18)]" : "bg-slate-100/90 text-slate-600 hover:bg-slate-200/80"}`}
                    >
                        Todas as bases
                    </button>
                    {[...bases].sort((left, right) => baseViewIndex(left.code) - baseViewIndex(right.code)).map((base) => {
                        const active = filterBase === base.id;
                        return (
                            <button
                                key={base.id}
                                type="button"
                                onClick={() => setFilterBase(active ? "" : base.id)}
                                className={`inline-flex items-center rounded-full px-2.5 py-1 font-medium transition-all ${active ? "bg-slate-900 text-white shadow-[0_10px_18px_rgba(15,23,42,0.18)] scale-[1.02]" : "bg-slate-100/90 text-slate-600 hover:bg-slate-200/80"}`}
                            >
                                {base.code}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {faculties.map((faculty) => {
                    const style = getFacultyStyle(faculty.abbreviation);
                    const active = hlFaculty === faculty.abbreviation;
                    return (
                        <button
                            key={faculty.id}
                            onClick={() => setHlFaculty(active ? null : faculty.abbreviation)}
                            className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-all ${style.pill} ${active ? "ring-2 ring-offset-1 scale-105" : hlFaculty ? "opacity-30" : ""}`}
                        >
                            <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                            {faculty.abbreviation}
                        </button>
                    );
                })}
                <span className="mx-1 text-slate-300">|</span>
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

            {editing && (
                <div className="space-y-2 rounded-xl border border-accent-200 bg-accent-50/30 p-3 shadow-sm">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-slate-900">
                            {editing.ruleId ? "Editar" : "Nova Regra"} — {editing.baseCode} · {DAY_LABELS[editing.dayOfWeek]} · {editing.period === "DAY" ? "☀️ Diurno" : "🌙 Noturno"}
                        </h2>
                        <button onClick={() => setEditing(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="block">
                            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Faculdade / Tipo</span>
                            <select
                                value={editing.facultyId}
                                onChange={(event) => setEditing({ ...editing, facultyId: event.target.value })}
                                className="mt-0.5 block w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                            >
                                <option value="">Selecionar...</option>
                                {faculties.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.abbreviation}</option>)}
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Vagas</span>
                            <input
                                type="number"
                                min={1}
                                max={20}
                                value={editing.capacity}
                                onChange={(event) => setEditing({ ...editing, capacity: +event.target.value })}
                                className="mt-0.5 block w-16 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                            />
                        </label>
                        <label className="flex items-center gap-1.5 self-end pb-1">
                            <input
                                type="checkbox"
                                checked={editing.isExtraShift}
                                onChange={(event) => setEditing({ ...editing, isExtraShift: event.target.checked })}
                                className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                            />
                            <span className="text-xs font-medium text-slate-700">Plantão Extra</span>
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
                                className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 ring-1 ring-red-600/20 transition-colors hover:bg-red-100"
                            >
                                <Trash2 className="h-3.5 w-3.5" /> Remover
                            </button>
                        )}
                    </div>
                    {error && <p className="text-xs text-red-600">{error}</p>}
                </div>
            )}

            {/* Base filtrada: dias na vertical — a base inteira cabe na tela do celular */}
            {singleBase ? (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                        <span className="text-sm font-bold text-slate-900">{singleBase.code}</span>
                        <span className="truncate text-xs text-slate-500">{singleBase.name}</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {DAYS.map((day) => {
                            const isEditingDay = editing?.baseId === singleBase.id && editing?.dayOfWeek === day;
                            return (
                                <div key={day} className={`flex items-start gap-3 px-3 py-2.5 transition-colors ${isEditingDay ? "bg-accent-50/40" : ""}`}>
                                    <span className="w-9 shrink-0 pt-1 text-xs font-semibold text-slate-700">{DAY_LABELS[day]}</span>
                                    <div className="min-w-0 flex-1 space-y-1.5">
                                        {renderPeriodChips(singleBase, day, "DAY", true)}
                                        {renderPeriodChips(singleBase, day, "NIGHT", true)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm" style={{ WebkitOverflowScrolling: "touch" }}>
                <div style={{ display: "grid", gridTemplateColumns: "72px repeat(7, minmax(76px, 1fr))", minWidth: "620px" }}>
                    <div className="sticky left-0 z-20 flex items-center justify-center border-b border-r border-slate-200 bg-slate-50 p-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Base</span>
                    </div>
                    {DAYS.map((day) => (
                        <div key={day} className="border-b border-slate-200 bg-slate-50 px-1 py-2 text-center">
                            <span className="hidden text-xs font-semibold text-slate-700 sm:inline">{DAY_LABELS[day]}</span>
                            <span className="text-xs font-semibold text-slate-700 sm:hidden">{DAY_SHORT[day]}</span>
                        </div>
                    ))}

                    {sortedBases.map((base) => (
                        <Fragment key={base.id}>
                            <div className="sticky left-0 z-10 flex flex-col items-center justify-center border-b border-r border-slate-100 bg-white px-1.5 py-2">
                                <span className="text-[11px] font-bold leading-tight text-slate-900">{base.code}</span>
                                <span className="max-w-[64px] truncate text-[9px] leading-tight text-slate-400">{base.name}</span>
                            </div>

                            {DAYS.map((day) => {
                                const isEditing = editing?.baseId === base.id && editing?.dayOfWeek === day;

                                return (
                                    <div key={`${base.id}-${day}`} className={`flex min-h-[56px] flex-col justify-center gap-0.5 border-b border-l border-slate-100 p-1 transition-colors ${isEditing ? "bg-accent-50/40" : "hover:bg-slate-50/50"}`}>
                                        {renderPeriodChips(base, day, "DAY")}
                                        {renderPeriodChips(base, day, "NIGHT")}
                                    </div>
                                );
                            })}
                        </Fragment>
                    ))}
                </div>
            </div>
            )}

            {sortedBases.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nenhuma base encontrada.</p>}
        </div>
    );
}