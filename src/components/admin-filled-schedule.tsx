"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, MapPin, Plus, Search, Trash2, X } from "lucide-react";
import { AdminManualAttendanceActions } from "@/components/admin-manual-attendance-actions";
import { StatusBadge } from "@/components/status-badge";
import { getBaseStyle, getFacultyStyle, getPeriodStyle, baseViewIndex } from "@/lib/base-colors";
import { formatBrazilTime, isWithinAdminAttendanceWindow, localDateStr } from "@/lib/utils";

type Rule = {
    id: string;
    baseId: string;
    baseCode: string;
    baseName: string;
    dayOfWeek: string;
    period: "DAY" | "NIGHT";
    facultyId: string;
    facultyAbbr: string;
    capacity: number;
    isActive: boolean;
};

type Base = {
    id: string;
    code: string;
    name: string;
    type: "USA" | "CENTRAL" | "CRL";
    isActive: boolean;
};

type Faculty = {
    id: string;
    abbreviation: string;
    name: string;
};

type UserRow = {
    id: string;
    name: string;
    isActive: boolean;
    role: string | null;
    facultyId: string | null;
    facultyAbbr: string | null;
};

type AssignmentDetail = {
    id: string;
    intern_id: string;
    intern_name: string;
    faculty_id: string;
    faculty_abbr: string;
    base_id: string;
    base_code: string;
    base_name: string;
    base_type: "USA" | "CENTRAL" | "CRL";
    date: string;
    period: "DAY" | "NIGHT";
    status: string;
    notes: string | null;
    geo_valid: boolean | null;
    checkin_status: string | null;
    checkin_method: string | null;
    checkin_at: string | null;
    totp_validated_at: string | null;
    validated_by_name: string | null;
    checkout_at: string | null;
    checkout_confirmed_by_name: string | null;
    checkout_notes: string | null;
};

type AllocationState = {
    baseId: string;
    baseCode: string;
    date: string;
    period: "DAY" | "NIGHT";
    facultyId: string;
    facultyAbbr: string;
};

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const PERIODS: Array<"DAY" | "NIGHT"> = ["DAY", "NIGHT"];
const DAY_LABEL_BY_KEY: Record<(typeof DAYS)[number], string> = {
    MON: "Seg",
    TUE: "Ter",
    WED: "Qua",
    THU: "Qui",
    FRI: "Sex",
    SAT: "Sáb",
    SUN: "Dom",
};

function getDayKey(date: string) {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][day] as typeof DAYS[number] | "SUN";
}

function formatDayMonth(date: string) {
    return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function getStatusRing(assignment: AssignmentDetail): string {
    if (assignment.status === "ABSENT") return "ring-2 ring-red-400";
    if (assignment.status === "CHECKED_IN" || assignment.status === "CHECKED_OUT") {
        return assignment.geo_valid === false ? "ring-2 ring-sky-400" : "ring-2 ring-emerald-400";
    }
    if (assignment.status === "CONFIRMED") return "ring-2 ring-emerald-400";
    return "";
}

function formatPeriod(period: "DAY" | "NIGHT") {
    return period === "DAY" ? "Diurno" : "Noturno";
}

function formatAssignmentCardName(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 2) return parts.join(" ");
    return `${parts[0]} ${parts[1]}`;
}

function formatAssignmentCardStatus(status: string) {
    switch (status) {
        case "CHECKED_IN":
            return "Check-in";
        case "CHECKED_OUT":
            return "Checkout";
        case "CONFIRMED":
            return "Confirmado";
        case "SCHEDULED":
            return "Escalado";
        case "ABSENT":
            return "Ausente";
        default:
            return status;
    }
}

function getAssignmentCardStatusClass(status: string) {
    switch (status) {
        case "CHECKED_IN":
            return "bg-sky-100 text-sky-700";
        case "CHECKED_OUT":
            return "bg-emerald-100 text-emerald-700";
        case "CONFIRMED":
            return "bg-emerald-100 text-emerald-700";
        case "ABSENT":
            return "bg-red-100 text-red-700";
        default:
            return "bg-slate-100 text-slate-600";
    }
}

export function AdminFilledSchedule() {
    const [bases, setBases] = useState<Base[]>([]);
    const [rules, setRules] = useState<Rule[]>([]);
    const [faculties, setFaculties] = useState<Faculty[]>([]);
    const [assignments, setAssignments] = useState<AssignmentDetail[]>([]);
    const [users, setUsers] = useState<UserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [weekStart, setWeekStart] = useState(() => {
        const date = new Date();
        date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
        return localDateStr(date);
    });
    const [searchIntern, setSearchIntern] = useState("");
    const [searchBase, setSearchBase] = useState("");
    const [filterBase, setFilterBase] = useState("");
    const [filterFaculty, setFilterFaculty] = useState("");
    const [filterPeriod, setFilterPeriod] = useState<"" | "DAY" | "NIGHT">("");
    const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
    const [allocation, setAllocation] = useState<AllocationState | null>(null);
    const [allocInternId, setAllocInternId] = useState("");
    const [allocSearch, setAllocSearch] = useState("");
    const [allocLoading, setAllocLoading] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const weekDates = useMemo(
        () => Array.from({ length: 7 }, (_, index) => {
            const date = new Date(`${weekStart}T12:00:00`);
            date.setDate(date.getDate() + index);
            return localDateStr(date);
        }),
        [weekStart],
    );
    const weekEnd = weekDates[6];
    const today = localDateStr();

    const loadBaseData = useCallback(async () => {
        const [basesRes, rulesRes, facultiesRes] = await Promise.all([
            fetch("/taximetro/api/admin/bases", { cache: "no-store" }),
            fetch("/taximetro/api/admin/rules", { cache: "no-store" }),
            fetch("/taximetro/api/admin/faculties", { cache: "no-store" }),
        ]);

        const [basesJson, rulesJson, facultiesJson] = await Promise.all([basesRes.json(), rulesRes.json(), facultiesRes.json()]);

        if (!basesJson.success || !rulesJson.success || !facultiesJson.success) {
            throw new Error("Não foi possível carregar metadados da escala.");
        }

        setBases(basesJson.data.filter((base: Base) => base.isActive !== false));
        setRules(rulesJson.data.filter((rule: Rule) => rule.isActive));
        setFaculties(facultiesJson.data);
    }, []);

    const loadAssignments = useCallback(async () => {
        const response = await fetch(`/taximetro/api/admin/assignments/detailed?from=${weekStart}&to=${weekEnd}`, { cache: "no-store" });
        const json = await response.json();
        if (!json.success) {
            throw new Error(json.error ?? "Não foi possível carregar a escala preenchida.");
        }
        setAssignments(json.data);
    }, [weekEnd, weekStart]);

    const loadUsers = useCallback(async () => {
        if (users.length > 0) return;

        setLoadingUsers(true);
        try {
            const response = await fetch("/taximetro/api/admin/users", { cache: "no-store" });
            const json = await response.json();
            if (!json.success) throw new Error(json.error ?? "Não foi possível carregar internos.");
            setUsers(json.data);
        } finally {
            setLoadingUsers(false);
        }
    }, [users.length]);

    const load = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        try {
            await Promise.all([loadBaseData(), loadAssignments()]);
        } catch (error) {
            setMessage({ type: "error", text: error instanceof Error ? error.message : "Erro ao carregar a escala preenchida." });
        } finally {
            setLoading(false);
        }
    }, [loadAssignments, loadBaseData]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (!selectedAssignmentId) return;
        const exists = assignments.some((assignment) => assignment.id === selectedAssignmentId);
        if (!exists) setSelectedAssignmentId(null);
    }, [assignments, selectedAssignmentId]);

    const facultyById = useMemo(() => new Map(faculties.map((faculty) => [faculty.id, faculty])), [faculties]);

    const filteredAssignments = useMemo(() => {
        const internQuery = searchIntern.trim().toLowerCase();
        const baseQuery = searchBase.trim().toLowerCase();
        return assignments.filter((assignment) => {
            if (filterBase && assignment.base_id !== filterBase) return false;
            if (filterFaculty && assignment.faculty_id !== filterFaculty) return false;
            if (filterPeriod && assignment.period !== filterPeriod) return false;
            if (internQuery && !assignment.intern_name.toLowerCase().includes(internQuery)) return false;
            if (baseQuery && !`${assignment.base_code} ${assignment.base_name}`.toLowerCase().includes(baseQuery)) return false;
            return true;
        });
    }, [assignments, filterBase, filterFaculty, filterPeriod, searchBase, searchIntern]);

    const filteredRules = useMemo(() => {
        const baseQuery = searchBase.trim().toLowerCase();
        return rules.filter((rule) => {
            if (filterBase && rule.baseId !== filterBase) return false;
            if (filterFaculty && rule.facultyId !== filterFaculty) return false;
            if (filterPeriod && rule.period !== filterPeriod) return false;
            if (baseQuery && !`${rule.baseCode} ${rule.baseName}`.toLowerCase().includes(baseQuery)) return false;
            return true;
        });
    }, [filterBase, filterFaculty, filterPeriod, rules, searchBase]);

    const assignmentsByBaseDate = useMemo(() => {
        const map = new Map<string, AssignmentDetail[]>();
        for (const assignment of filteredAssignments) {
            const key = `${assignment.base_id}|${assignment.date}`;
            const rows = map.get(key) ?? [];
            rows.push(assignment);
            map.set(key, rows);
        }
        return map;
    }, [filteredAssignments]);

    const visibleBases = useMemo(() => {
        const hasContent = (base: Base) => weekDates.some((date) => {
            const dayKey = getDayKey(date);
            const rulesForDay = filteredRules.filter((rule) => rule.baseId === base.id && rule.dayOfWeek === dayKey);
            const assignmentsForDay = assignmentsByBaseDate.get(`${base.id}|${date}`) ?? [];
            return rulesForDay.length > 0 || assignmentsForDay.length > 0;
        });

        return bases
            .filter((base) => !filterBase || base.id === filterBase)
            .filter((base) => hasContent(base))
            .sort((left, right) => {
                if (left.type !== right.type) {
                    const rank = (type: Base["type"]) => (type === "USA" ? 0 : type === "CENTRAL" ? 1 : 2);
                    return rank(left.type) - rank(right.type);
                }
                return baseViewIndex(left.code) - baseViewIndex(right.code) || left.code.localeCompare(right.code);
            });
    }, [assignmentsByBaseDate, bases, filterBase, filteredRules, weekDates]);

    const usaBases = visibleBases.filter((base) => base.type === "USA");
    const regulationBases = visibleBases.filter((base) => base.type !== "USA");

    const selectedAssignment = useMemo(
        () => assignments.find((assignment) => assignment.id === selectedAssignmentId) ?? null,
        [assignments, selectedAssignmentId],
    );

    const eligibleInterns = useMemo(() => {
        if (!allocation) return [];

        const query = allocSearch.trim().toLowerCase();
        const busyInternIds = new Set(
            assignments
                .filter((assignment) => assignment.date === allocation.date && assignment.period === allocation.period)
                .map((assignment) => assignment.intern_id),
        );

        return users
            .filter((user) => user.role === "INTERN" && user.isActive)
            .filter((user) => user.facultyId === allocation.facultyId)
            .filter((user) => !busyInternIds.has(user.id))
            .filter((user) => !query || user.name.toLowerCase().includes(query))
            .sort((left, right) => left.name.localeCompare(right.name));
    }, [allocSearch, allocation, assignments, users]);

    async function openAllocation(slot: AllocationState) {
        await loadUsers();
        setAllocation(slot);
        setAllocInternId("");
        setAllocSearch("");
        setMessage(null);
    }

    async function createAssignment() {
        if (!allocation || !allocInternId) return;
        setAllocLoading(true);
        setMessage(null);

        try {
            const response = await fetch("/taximetro/api/assignments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    internId: allocInternId,
                    facultyId: allocation.facultyId,
                    baseId: allocation.baseId,
                    date: allocation.date,
                    period: allocation.period,
                }),
            });
            const json = await response.json();
            if (!json.success) throw new Error(json.error ?? "Não foi possível alocar o interno.");
            setAllocation(null);
            setMessage({ type: "success", text: "Interno alocado com sucesso." });
            await loadAssignments();
        } catch (error) {
            setMessage({ type: "error", text: error instanceof Error ? error.message : "Erro ao alocar interno." });
        } finally {
            setAllocLoading(false);
        }
    }

    async function cancelAssignment(assignmentId: string) {
        setRemovingId(assignmentId);
        setMessage(null);
        try {
            const response = await fetch("/taximetro/api/assignments", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: assignmentId, status: "CANCELLED" }),
            });
            const json = await response.json();
            if (!json.success) throw new Error(json.error ?? "Não foi possível remover o plantão.");
            setSelectedAssignmentId(null);
            setMessage({ type: "success", text: "Plantão removido da escala." });
            await loadAssignments();
        } catch (error) {
            setMessage({ type: "error", text: error instanceof Error ? error.message : "Erro ao remover plantão." });
        } finally {
            setRemovingId(null);
        }
    }

    function shiftWeek(days: number) {
        const date = new Date(`${weekStart}T12:00:00`);
        date.setDate(date.getDate() + days);
        setWeekStart(localDateStr(date));
    }

    function renderBaseSection(title: string, rows: Base[]) {
        if (rows.length === 0) return null;

        return (
            <section className="space-y-3">
                <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
                    <span className="text-xs text-slate-400">{rows.length} bases</span>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="min-w-[1180px]" style={{ display: "grid", gridTemplateColumns: "160px repeat(7, minmax(146px, 1fr))" }}>
                        <div className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">Base</div>
                        {weekDates.map((date) => (
                            <div key={date} className={`border-b border-slate-200 px-2 py-2 text-center text-xs font-semibold ${date === today ? "bg-accent-50/60 text-accent-700" : "bg-slate-50 text-slate-500"}`}>
                                {DAY_LABEL_BY_KEY[getDayKey(date)]}<br />
                                <span className="font-normal">{formatDayMonth(date)}</span>
                            </div>
                        ))}

                        {rows.map((base) => (
                            <Fragment key={base.id}>
                                <div className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-slate-900">{base.code}</span>
                                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${getBaseStyle(base.type).pill}`}>
                                            {getBaseStyle(base.type).label}
                                        </span>
                                    </div>
                                    <p className="mt-0.5 text-[11px] text-slate-500">{base.name}</p>
                                </div>

                                {weekDates.map((date) => {
                                    const dayKey = getDayKey(date);
                                    const cellAssignments = assignmentsByBaseDate.get(`${base.id}|${date}`) ?? [];
                                    const periods = filterPeriod ? [filterPeriod] : PERIODS;

                                    return (
                                        <div key={`${base.id}|${date}`} className={`border-b border-slate-100 px-2 py-2 min-h-[132px] ${date === today ? "bg-accent-50/20" : ""}`}>
                                            <div className="space-y-1.5">
                                                {periods.map((period) => {
                                                    const periodAssignments = cellAssignments.filter((assignment) => assignment.period === period);
                                                    const periodRules = filteredRules.filter((rule) => rule.baseId === base.id && rule.dayOfWeek === dayKey && rule.period === period);
                                                    const facultyIds = [...new Set([...periodRules.map((rule) => rule.facultyId), ...periodAssignments.map((assignment) => assignment.faculty_id)])]
                                                        .sort((left, right) => {
                                                            const leftFaculty = facultyById.get(left)?.abbreviation ?? periodAssignments.find((assignment) => assignment.faculty_id === left)?.faculty_abbr ?? "";
                                                            const rightFaculty = facultyById.get(right)?.abbreviation ?? periodAssignments.find((assignment) => assignment.faculty_id === right)?.faculty_abbr ?? "";
                                                            return leftFaculty.localeCompare(rightFaculty);
                                                        });

                                                    if (facultyIds.length === 0) return null;

                                                    return (
                                                        <div key={`${base.id}|${date}|${period}`} className="rounded-lg border border-slate-200 bg-slate-50/60 p-1.5">
                                                            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                                                <span>{getPeriodStyle(period).emoji}</span>
                                                                <span>{getPeriodStyle(period).label}</span>
                                                            </div>

                                                            <div className="space-y-1">
                                                                {facultyIds.map((facultyId) => {
                                                                    const facultyRule = periodRules.find((rule) => rule.facultyId === facultyId);
                                                                    const facultyAssignments = periodAssignments.filter((assignment) => assignment.faculty_id === facultyId)
                                                                        .sort((left, right) => left.intern_name.localeCompare(right.intern_name));
                                                                    const facultyAbbr = facultyRule?.facultyAbbr ?? facultyAssignments[0]?.faculty_abbr ?? "—";
                                                                    const facultyStyle = getFacultyStyle(facultyAbbr);
                                                                    const openCount = Math.max((facultyRule?.capacity ?? 0) - facultyAssignments.length, 0);
                                                                    const blockClass = facultyRule
                                                                        ? openCount > 0
                                                                            ? "border-amber-200 bg-amber-50/60"
                                                                            : "border-emerald-200 bg-emerald-50/50"
                                                                        : "border-rose-200 bg-rose-50/60";

                                                                    return (
                                                                        <div key={`${base.id}|${date}|${period}|${facultyId}`} className={`rounded-md border p-1.5 ${blockClass}`}>
                                                                            <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-500">
                                                                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${facultyStyle.pill}`}>
                                                                                    <span className={`h-1.5 w-1.5 rounded-full ${facultyStyle.dot}`} />
                                                                                    {facultyAbbr}
                                                                                </span>
                                                                                <span>{facultyAssignments.length}/{facultyRule?.capacity ?? facultyAssignments.length}</span>
                                                                            </div>

                                                                            <div className="space-y-1">
                                                                                {facultyAssignments.map((assignment) => (
                                                                                    <button
                                                                                        key={assignment.id}
                                                                                        type="button"
                                                                                        onClick={() => setSelectedAssignmentId(assignment.id)}
                                                                                        className={`group flex w-full flex-col items-start gap-1 rounded-md px-2 py-1.5 text-left transition hover:opacity-80 ${getPeriodStyle(period).bg} ${getPeriodStyle(period).text} ${getStatusRing(assignment)}`}
                                                                                        title={`${assignment.intern_name} · ${assignment.status}`}
                                                                                    >
                                                                                        <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold leading-tight text-slate-900">
                                                                                            {formatAssignmentCardName(assignment.intern_name)}
                                                                                        </span>
                                                                                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${getAssignmentCardStatusClass(assignment.status)}`}>
                                                                                            {formatAssignmentCardStatus(assignment.status)}
                                                                                        </span>
                                                                                    </button>
                                                                                ))}

                                                                                {openCount > 0 && !searchIntern && facultyRule && (
                                                                                    Array.from({ length: openCount }, (_, index) => (
                                                                                        <button
                                                                                            key={`${base.id}|${date}|${period}|${facultyId}|vacancy-${index + 1}`}
                                                                                            type="button"
                                                                                            onClick={() => openAllocation({ baseId: base.id, baseCode: base.code, date, period, facultyId, facultyAbbr })}
                                                                                            className="flex w-full items-center gap-2 rounded-md border border-dashed border-amber-300 bg-white/90 px-2 py-1 text-left text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100"
                                                                                        >
                                                                                            <Plus className="h-3.5 w-3.5 shrink-0" />
                                                                                            <span className="truncate">Vaga</span>
                                                                                            {openCount > 1 && <span className="ml-auto text-[10px] text-amber-600">{index + 1}/{openCount}</span>}
                                                                                        </button>
                                                                                    ))
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })}

                                                {periods.every((period) => {
                                                    const periodAssignments = cellAssignments.filter((assignment) => assignment.period === period);
                                                    const periodRules = filteredRules.filter((rule) => rule.baseId === base.id && rule.dayOfWeek === dayKey && rule.period === period);
                                                    return periodAssignments.length === 0 && periodRules.length === 0;
                                                }) && <span className="text-xs italic text-slate-300">—</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </Fragment>
                        ))}
                    </div>
                </div>
            </section>
        );
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h2 className="text-2xl font-semibold text-slate-900">Escala</h2>
                    <p className="text-sm text-slate-500">
                        Visão consolidada das escalas dos líderes, com ocupação real por base, detalhes de check-in e ações rápidas.
                    </p>
                </div>

                <div className="flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                    <button type="button" onClick={() => shiftWeek(-7)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition">
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => {
                        const date = new Date();
                        date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
                        setWeekStart(localDateStr(date));
                    }} className="min-w-44 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 transition">
                        {formatDayMonth(weekStart)} — {formatDayMonth(weekEnd)}
                    </button>
                    <button type="button" onClick={() => shiftWeek(7)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition">
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[1.1fr,1fr,0.8fr,0.8fr,0.8fr]">
                <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input value={searchIntern} onChange={(event) => setSearchIntern(event.target.value)} placeholder="Buscar interno..." className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white" />
                </label>

                <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input value={searchBase} onChange={(event) => setSearchBase(event.target.value)} placeholder="Buscar base..." className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white" />
                </label>

                <select value={filterBase} onChange={(event) => setFilterBase(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white">
                    <option value="">Todas as bases</option>
                    {bases.map((base) => <option key={base.id} value={base.id}>{base.code} — {base.name}</option>)}
                </select>

                <select value={filterFaculty} onChange={(event) => setFilterFaculty(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white">
                    <option value="">Todas faculdades</option>
                    {faculties.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.abbreviation}</option>)}
                </select>

                <select value={filterPeriod} onChange={(event) => setFilterPeriod(event.target.value as "" | "DAY" | "NIGHT")} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white">
                    <option value="">Todos turnos</option>
                    <option value="DAY">Diurno</option>
                    <option value="NIGHT">Noturno</option>
                </select>
            </div>

            {message && (
                <div className={`rounded-xl px-4 py-3 text-sm ${message.type === "success" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-red-200 bg-red-50 text-red-700"}`}>
                    {message.text}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-500 shadow-sm">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando escala preenchida...
                </div>
            ) : (
                <div className="space-y-6">
                    {renderBaseSection("USA — Bases × Dia", usaBases)}
                    {renderBaseSection("Regulação — CRU / CRL", regulationBases)}
                    {visibleBases.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">Nenhuma alocação ou vaga encontrada para os filtros da semana.</div>}
                </div>
            )}

            {allocation && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAllocation(null)}>
                    <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
                            <div>
                                <h3 className="text-lg font-semibold text-slate-900">Alocar interno na vaga</h3>
                                <p className="text-sm text-slate-500">{allocation.baseCode} · {formatDayMonth(allocation.date)} · {formatPeriod(allocation.period)} · {allocation.facultyAbbr}</p>
                            </div>
                            <button type="button" onClick={() => setAllocation(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-4 w-4" /></button>
                        </div>

                        <div className="space-y-3 px-6 py-4">
                            <label className="relative block">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <input value={allocSearch} onChange={(event) => setAllocSearch(event.target.value)} placeholder="Buscar interno da faculdade..." className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white" />
                            </label>

                            <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
                                {loadingUsers ? (
                                    <div className="flex items-center justify-center py-8 text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando internos...</div>
                                ) : eligibleInterns.length === 0 ? (
                                    <p className="py-8 text-center text-sm text-slate-400">Nenhum interno elegível nesta vaga.</p>
                                ) : (
                                    eligibleInterns.map((user) => (
                                        <button
                                            key={user.id}
                                            type="button"
                                            onClick={() => setAllocInternId(user.id)}
                                            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${allocInternId === user.id ? "bg-accent-50 text-accent-700 ring-1 ring-accent-300" : "bg-white text-slate-700 hover:bg-slate-100"}`}
                                        >
                                            <span>{user.name}</span>
                                            <span className="text-xs text-slate-400">{user.facultyAbbr}</span>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
                            <button type="button" onClick={() => setAllocation(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
                            <button type="button" disabled={allocLoading || !allocInternId} onClick={createAssignment} className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50">
                                {allocLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Alocar na escala
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {selectedAssignment && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelectedAssignmentId(null)}>
                    <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-xl font-semibold text-slate-900">{selectedAssignment.intern_name}</h3>
                                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${getFacultyStyle(selectedAssignment.faculty_abbr).pill}`}>
                                        <span className={`h-1.5 w-1.5 rounded-full ${getFacultyStyle(selectedAssignment.faculty_abbr).dot}`} />
                                        {selectedAssignment.faculty_abbr}
                                    </span>
                                </div>
                                <p className="mt-1 text-sm text-slate-500">{selectedAssignment.base_code} — {selectedAssignment.base_name} · {formatDayMonth(selectedAssignment.date)} · {formatPeriod(selectedAssignment.period)}</p>
                            </div>
                            <button type="button" onClick={() => setSelectedAssignmentId(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-4 w-4" /></button>
                        </div>

                        <div className="grid gap-6 px-6 py-5 lg:grid-cols-[1.1fr,0.9fr]">
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <StatusBadge status={selectedAssignment.status} />
                                    {selectedAssignment.notes?.includes("[REMANEJADO]") && <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">Remanejado</span>}
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Check-in</p>
                                        <p className="mt-1 text-sm font-medium text-slate-900">{selectedAssignment.checkin_at ? formatBrazilTime(selectedAssignment.checkin_at) : "Sem check-in"}</p>
                                        <p className="mt-1 text-xs text-slate-500">Status: {selectedAssignment.checkin_status ?? "—"}</p>
                                        <p className="mt-1 text-xs text-slate-500">Validado por: {selectedAssignment.validated_by_name ?? "—"}</p>
                                        <p className="mt-1 text-xs text-slate-500">Método: {selectedAssignment.checkin_method ?? "—"}</p>
                                    </div>

                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Checkout</p>
                                        <p className="mt-1 text-sm font-medium text-slate-900">{selectedAssignment.checkout_at ? formatBrazilTime(selectedAssignment.checkout_at) : "Sem checkout"}</p>
                                        <p className="mt-1 text-xs text-slate-500">Confirmado por: {selectedAssignment.checkout_confirmed_by_name ?? "—"}</p>
                                        <p className="mt-1 text-xs text-slate-500">Geo: {selectedAssignment.geo_valid === null ? "—" : selectedAssignment.geo_valid ? "Dentro do raio" : "Fora do raio"}</p>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-200 bg-white p-4">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Notas do plantão</p>
                                    <p className="mt-2 text-sm text-slate-700">{selectedAssignment.notes || "Sem observações operacionais."}</p>
                                    {selectedAssignment.checkout_notes && <p className="mt-2 text-xs text-slate-500">Checkout: {selectedAssignment.checkout_notes}</p>}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <Link href={`/taximetro/admin/remanejamento?assignmentId=${selectedAssignment.id}`} className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-100">
                                        <MapPin className="h-4 w-4" /> Remanejar / alocar em outra base
                                    </Link>

                                    <button
                                        type="button"
                                        disabled={removingId === selectedAssignment.id}
                                        onClick={() => cancelAssignment(selectedAssignment.id)}
                                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {removingId === selectedAssignment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Remover da escala
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div>
                                    <p className="text-sm font-semibold text-slate-900">Acompanhamento operacional</p>
                                    <p className="text-xs text-slate-500">Ações manuais disponíveis até a data seguinte, inclusive.</p>
                                </div>

                                {isWithinAdminAttendanceWindow(selectedAssignment.date) ? (
                                    <AdminManualAttendanceActions assignmentId={selectedAssignment.id} status={selectedAssignment.status} onUpdated={loadAssignments} />
                                ) : (
                                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">
                                        Janela manual encerrada para este plantão.
                                    </div>
                                )}

                                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500">
                                    <p>Interno: <span className="font-medium text-slate-700">{selectedAssignment.intern_name}</span></p>
                                    <p className="mt-1">Faculdade: <span className="font-medium text-slate-700">{selectedAssignment.faculty_abbr}</span></p>
                                    <p className="mt-1">Base: <span className="font-medium text-slate-700">{selectedAssignment.base_code}</span></p>
                                    <p className="mt-1">Turno: <span className="font-medium text-slate-700">{formatPeriod(selectedAssignment.period)}</span></p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}