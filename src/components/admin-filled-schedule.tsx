"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Loader2, MapPin, Moon, Plus, Search, Sun, Trash2, X } from "lucide-react";
import { AdminManualAttendanceActions } from "@/components/admin-manual-attendance-actions";
import { StatusBadge } from "@/components/status-badge";
import { getBaseStyle, baseViewIndex } from "@/lib/base-colors";
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
    facultyId: string | null;
    facultyAbbr: string | null;
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

const SLOT_LIMIT_PER_PERIOD = 2;

type PeriodGridSlot =
    | { kind: "assignment"; key: string; assignment: AssignmentDetail }
    | { kind: "vacancy"; key: string; allocation: AllocationState; facultyAbbr: string }
    | { kind: "open"; key: string; allocation: AllocationState; period: "DAY" | "NIGHT" };

function getDayKey(date: string) {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][day] as typeof DAYS[number] | "SUN";
}

function formatDayMonth(date: string) {
    return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatPeriod(period: "DAY" | "NIGHT") {
    return period === "DAY" ? "Diurno" : "Noturno";
}

function formatAssignmentCardName(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[1]}`;
}

function getDatePhase(date: string) {
    const today = localDateStr();
    if (date < today) return "past" as const;
    if (date > today) return "future" as const;
    return "today" as const;
}

function isPendingStatus(status: string) {
    return status === "SCHEDULED" || status === "CONFIRMED";
}

function getNeutralFacultyBadgeClass(period?: "DAY" | "NIGHT") {
    if (period === "NIGHT") {
        return {
            pill: "border border-white/14 bg-white/10 text-white/88",
            dot: "bg-white/75",
        };
    }

    return {
        pill: "border border-stone-300 bg-white/66 text-stone-700",
        dot: "bg-stone-400",
    };
}

function getPeriodTone(period: "DAY" | "NIGHT") {
    return period === "DAY"
        ? {
            shell: "border-stone-300 bg-[linear-gradient(180deg,rgba(248,243,235,0.96),rgba(230,216,196,0.88))] shadow-[0_12px_24px_rgba(120,113,108,0.08),inset_0_1px_0_rgba(255,255,255,0.74)] backdrop-blur-sm",
            ghost: "border-stone-300 bg-[linear-gradient(135deg,rgba(244,238,229,0.84),rgba(225,210,190,0.72))] text-stone-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]",
            meta: "text-stone-600",
            chip: "border-stone-400/70 bg-white/65 text-stone-700",
            overflow: "bg-white/76 text-stone-700",
            action: "bg-stone-950 text-white shadow-[0_8px_18px_rgba(28,25,23,0.18)]",
        }
        : {
            shell: "border-sky-950/50 bg-[linear-gradient(180deg,rgba(20,42,74,0.94),rgba(7,18,36,0.98))] shadow-[0_14px_28px_rgba(15,23,42,0.24),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm",
            ghost: "border-sky-700/45 bg-[linear-gradient(135deg,rgba(26,49,86,0.8),rgba(12,28,52,0.88))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
            meta: "text-white/72",
            chip: "border-white/14 bg-white/10 text-white",
            overflow: "bg-white/12 text-white/88",
            action: "bg-white/14 text-white shadow-[0_8px_18px_rgba(2,8,23,0.28)]",
        };
}

function getMutedSlotClass(date: string, kind: "assignment" | "vacancy" | "open", status?: string) {
    const phase = getDatePhase(date);
    if (kind === "assignment") {
        const isIssue = status === "ABSENT" || (date <= localDateStr() && isPendingStatus(status ?? ""));
        if (status === "ABSENT") return "opacity-100";
        if (phase === "past") {
            return isIssue
                ? "opacity-80 saturate-[0.88]"
                : "opacity-35 saturate-[0.38]";
        }
        if (phase === "future") return "opacity-80";
        if (status === "CHECKED_OUT") return "opacity-62 saturate-[0.74]";
        return "opacity-100";
    }

    if (phase === "past") return "opacity-35 saturate-[0.34]";
    if (phase === "future") return "opacity-74";
    return "opacity-52";
}

function getAssignmentVisualState(assignment: AssignmentDetail, period: "DAY" | "NIGHT") {
    const phase = getDatePhase(assignment.date);
    const isPending = isPendingStatus(assignment.status) && assignment.date <= localDateStr();

    if (assignment.status === "ABSENT") {
        return {
            cardClass: "border-[2.5px] border-red-700 bg-[linear-gradient(135deg,rgba(69,10,10,0.98),rgba(153,27,27,0.96))] text-white shadow-[0_0_0_1px_rgba(127,29,29,0.34),0_18px_34px_rgba(127,29,29,0.22)]",
            iconWrapClass: "border border-white/12 bg-white/10",
            iconClass: "text-red-100",
            dotClass: "bg-red-300 shadow-[0_0_0_5px_rgba(248,113,113,0.22)]",
            metaLabel: "Falta confirmada",
            metaClass: "text-white/72",
            icon: AlertTriangle as LucideIcon,
            darkSurface: true,
            animationClass: "animate-[pulse_0.9s_ease-out_1]",
        };
    }

    if (isPending) {
        return {
            cardClass: "border-[2.5px] border-orange-500 bg-[linear-gradient(135deg,rgba(255,247,237,0.99),rgba(254,215,170,0.96))] text-stone-950 shadow-[0_0_0_1px_rgba(251,146,60,0.26),0_16px_30px_rgba(251,146,60,0.18)]",
            iconWrapClass: "border border-orange-300/80 bg-white/68",
            iconClass: "text-orange-700",
            dotClass: "bg-orange-500 shadow-[0_0_0_5px_rgba(249,115,22,0.2)]",
            metaLabel: phase === "past" ? "Pendência passada" : "Sem check-in",
            metaClass: "text-stone-700/80",
            icon: Clock3 as LucideIcon,
            darkSurface: false,
            animationClass: "animate-[pulse_0.9s_ease-out_1]",
        };
    }

    if (assignment.status === "CHECKED_OUT") {
        return {
            cardClass: "border border-zinc-300 bg-[linear-gradient(135deg,rgba(250,250,250,0.96),rgba(228,228,231,0.92))] text-zinc-700 shadow-[0_8px_16px_rgba(63,63,70,0.08)]",
            iconWrapClass: "border border-zinc-300 bg-white/72",
            iconClass: "text-zinc-500",
            dotClass: "bg-zinc-400 shadow-[0_0_0_4px_rgba(161,161,170,0.14)]",
            metaLabel: assignment.checkout_at ? `Checkout ${formatBrazilTime(assignment.checkout_at)}` : "Plantão encerrado",
            metaClass: "text-zinc-500",
            icon: CheckCircle2 as LucideIcon,
            darkSurface: false,
            animationClass: "",
        };
    }

    if (assignment.status === "CHECKED_IN") {
        return period === "NIGHT"
            ? {
                cardClass: "border border-sky-700/60 bg-[linear-gradient(135deg,rgba(31,58,99,0.96),rgba(10,25,47,0.99))] text-white shadow-[0_12px_24px_rgba(15,23,42,0.22)]",
                iconWrapClass: "border border-white/14 bg-white/10",
                iconClass: "text-white",
                dotClass: "bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.14)]",
                metaLabel: assignment.checkin_at ? `Check-in ${formatBrazilTime(assignment.checkin_at)}` : "Presença registrada",
                metaClass: "text-white/72",
                icon: CheckCircle2 as LucideIcon,
                darkSurface: true,
                animationClass: "",
            }
            : {
                cardClass: "border border-stone-400 bg-[linear-gradient(135deg,rgba(251,247,240,0.98),rgba(228,214,193,0.94))] text-stone-950 shadow-[0_10px_22px_rgba(120,113,108,0.1)]",
                iconWrapClass: "border border-stone-300 bg-white/72",
                iconClass: "text-stone-700",
                dotClass: "bg-stone-700 shadow-[0_0_0_4px_rgba(87,83,78,0.14)]",
                metaLabel: assignment.checkin_at ? `Check-in ${formatBrazilTime(assignment.checkin_at)}` : "Presença registrada",
                metaClass: "text-stone-600",
                icon: CheckCircle2 as LucideIcon,
                darkSurface: false,
                animationClass: "",
            };
    }

    if (period === "NIGHT") {
        return {
            cardClass: "border border-sky-700/55 bg-[linear-gradient(135deg,rgba(31,58,99,0.95),rgba(10,25,47,0.98))] text-white shadow-[0_12px_24px_rgba(15,23,42,0.22)]",
            iconWrapClass: "border border-white/14 bg-white/10",
            iconClass: "text-white",
            dotClass: "bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.12)]",
            metaLabel: phase === "future" ? "Plantão futuro" : "Escala de hoje",
            metaClass: "text-white/72",
            icon: Moon as LucideIcon,
            darkSurface: true,
            animationClass: "",
        };
    }

    return {
        cardClass: "border border-stone-400 bg-[linear-gradient(135deg,rgba(251,247,240,0.98),rgba(228,214,193,0.94))] text-stone-950 shadow-[0_10px_22px_rgba(120,113,108,0.1)]",
        iconWrapClass: "border border-stone-300 bg-white/72",
        iconClass: "text-stone-700",
        dotClass: "bg-stone-600 shadow-[0_0_0_4px_rgba(120,113,108,0.12)]",
        metaLabel: phase === "future" ? "Plantão futuro" : "Escala de hoje",
        metaClass: "text-stone-600",
        icon: Sun as LucideIcon,
        darkSurface: false,
        animationClass: "",
    };
}

function getAssignmentCardTitle(assignment: AssignmentDetail) {
    const checkinText = assignment.checkin_at ? formatBrazilTime(assignment.checkin_at) : "sem check-in";
    const checkoutText = assignment.checkout_at ? formatBrazilTime(assignment.checkout_at) : "sem checkout";
    return `${assignment.intern_name} • ${assignment.base_code} • ${formatPeriod(assignment.period)} • check-in ${checkinText} • checkout ${checkoutText}`;
}

function AssignmentSlotCard({ assignment, period, onSelect }: { assignment: AssignmentDetail; period: "DAY" | "NIGHT"; onSelect: (id: string) => void }) {
    const visual = getAssignmentVisualState(assignment, period);
    const Icon = visual.icon;
    const facultyTone = getNeutralFacultyBadgeClass(visual.darkSurface ? "NIGHT" : undefined);

    return (
        <button
            type="button"
            onClick={() => onSelect(assignment.id)}
            className={`group flex min-h-[56px] w-full min-w-0 items-stretch justify-between gap-2 overflow-hidden rounded-xl px-2.5 py-2 text-left transition hover:-translate-y-[1px] hover:shadow-[0_12px_20px_rgba(15,23,42,0.12)] ${visual.cardClass} ${visual.animationClass} ${getMutedSlotClass(assignment.date, "assignment", assignment.status)}`}
            title={getAssignmentCardTitle(assignment)}
        >
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold leading-tight">{formatAssignmentCardName(assignment.intern_name)}</span>
                <span className="mt-1 flex items-center gap-2">
                    <span className={`inline-flex max-w-[84px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${facultyTone.pill}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${facultyTone.dot}`} />
                        <span className="truncate">{assignment.faculty_abbr}</span>
                    </span>
                    <span className={`truncate text-[10px] font-semibold uppercase tracking-[0.12em] ${visual.metaClass}`}>{visual.metaLabel}</span>
                </span>
            </span>

            <span className="flex w-[38px] shrink-0 flex-col items-end justify-between self-stretch">
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl ${visual.iconWrapClass}`}>
                    <Icon className={`h-4 w-4 ${visual.iconClass}`} strokeWidth={2.2} />
                </span>
                <span className={`h-2.5 w-2.5 rounded-full ${visual.dotClass}`} />
            </span>
        </button>
    );
}

function VacancySlotCard({ facultyAbbr, allocation, period, onOpen }: { facultyAbbr: string; allocation: AllocationState; period: "DAY" | "NIGHT"; onOpen: (slot: AllocationState) => void }) {
    const tone = getPeriodTone(period);
    const facultyTone = getNeutralFacultyBadgeClass(period === "NIGHT" ? "NIGHT" : undefined);

    return (
        <button
            type="button"
            onClick={() => onOpen(allocation)}
            className={`flex min-h-[56px] w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-dashed px-2.5 py-2 text-left transition hover:-translate-y-[1px] hover:shadow-[0_12px_20px_rgba(15,23,42,0.1)] ${tone.ghost} ${getMutedSlotClass(allocation.date, "vacancy")}`}
            title={`Alocar interno em ${facultyAbbr}`}
        >
            <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-black uppercase tracking-[0.16em] opacity-75">Vaga</span>
                <span className={`mt-1 inline-flex max-w-[84px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${facultyTone.pill}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${facultyTone.dot}`} />
                    <span className="truncate">{facultyAbbr}</span>
                </span>
            </span>
            <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${tone.action}`}>
                <Plus className="h-4 w-4" />
            </span>
        </button>
    );
}

function OpenSlotCard({ allocation, period, onOpen }: { allocation: AllocationState; period: "DAY" | "NIGHT"; onOpen: (slot: AllocationState) => void }) {
    const tone = getPeriodTone(period);

    return (
        <button
            type="button"
            onClick={() => onOpen(allocation)}
            className={`flex min-h-[52px] w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-dashed px-2.5 py-2 text-left transition hover:-translate-y-[1px] hover:shadow-[0_12px_20px_rgba(15,23,42,0.08)] ${tone.ghost} ${getMutedSlotClass(allocation.date, "open")}`}
        >
            <span className={`min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${tone.meta}`}>Livre para alocação</span>
            <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${tone.action}`}>
                <Plus className="h-3.5 w-3.5" />
            </span>
        </button>
    );
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
    const [filterBase, setFilterBase] = useState("");
    const [filterFaculty, setFilterFaculty] = useState("");
    const [filterPeriod, setFilterPeriod] = useState<"" | "DAY" | "NIGHT">("");
    const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
    const [allocation, setAllocation] = useState<AllocationState | null>(null);
    const [allocFacultyId, setAllocFacultyId] = useState("");
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

    const visibleFacultyOptions = useMemo(() => {
        const ids = new Set<string>();
        for (const rule of rules) ids.add(rule.facultyId);
        for (const assignment of assignments) ids.add(assignment.faculty_id);
        return faculties
            .filter((faculty) => ids.has(faculty.id))
            .sort((left, right) => left.abbreviation.localeCompare(right.abbreviation));
    }, [assignments, faculties, rules]);

    const allocationFacultyOptions = useMemo(() => {
        const source = visibleFacultyOptions.length > 0 ? visibleFacultyOptions : faculties;
        return [...source].sort((left, right) => left.abbreviation.localeCompare(right.abbreviation));
    }, [faculties, visibleFacultyOptions]);

    const filteredAssignments = useMemo(() => {
        const internQuery = searchIntern.trim().toLowerCase();
        return assignments.filter((assignment) => {
            if (filterBase && assignment.base_id !== filterBase) return false;
            if (filterFaculty && assignment.faculty_id !== filterFaculty) return false;
            if (filterPeriod && assignment.period !== filterPeriod) return false;
            if (internQuery && !assignment.intern_name.toLowerCase().includes(internQuery)) return false;
            return true;
        });
    }, [assignments, filterBase, filterFaculty, filterPeriod, searchIntern]);

    const filteredRules = useMemo(() => {
        return rules.filter((rule) => {
            if (filterBase && rule.baseId !== filterBase) return false;
            if (filterFaculty && rule.facultyId !== filterFaculty) return false;
            if (filterPeriod && rule.period !== filterPeriod) return false;
            return true;
        });
    }, [filterBase, filterFaculty, filterPeriod, rules]);

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

    const baseToggleOptions = useMemo(() => {
        return [...bases].sort((left, right) => {
            if (left.type !== right.type) {
                const rank = (type: Base["type"]) => (type === "USA" ? 0 : type === "CENTRAL" ? 1 : 2);
                return rank(left.type) - rank(right.type);
            }
            return baseViewIndex(left.code) - baseViewIndex(right.code) || left.code.localeCompare(right.code);
        });
    }, [bases]);

    const selectedAssignment = useMemo(
        () => assignments.find((assignment) => assignment.id === selectedAssignmentId) ?? null,
        [assignments, selectedAssignmentId],
    );

    const buildPeriodSlots = useCallback((base: Base, date: string, period: "DAY" | "NIGHT") => {
        const dayKey = getDayKey(date);
        const cellAssignments = assignmentsByBaseDate.get(`${base.id}|${date}`) ?? [];
        const periodAssignments = cellAssignments
            .filter((assignment) => assignment.period === period)
            .sort((left, right) => {
                const facultyCompare = left.faculty_abbr.localeCompare(right.faculty_abbr);
                if (facultyCompare !== 0) return facultyCompare;
                return left.intern_name.localeCompare(right.intern_name);
            });
        const periodRules = filteredRules.filter((rule) => rule.baseId === base.id && rule.dayOfWeek === dayKey && rule.period === period);
        const facultyIds = [...new Set([...periodRules.map((rule) => rule.facultyId), ...periodAssignments.map((assignment) => assignment.faculty_id)])]
            .sort((left, right) => {
                const leftFaculty = facultyById.get(left)?.abbreviation ?? periodAssignments.find((assignment) => assignment.faculty_id === left)?.faculty_abbr ?? "";
                const rightFaculty = facultyById.get(right)?.abbreviation ?? periodAssignments.find((assignment) => assignment.faculty_id === right)?.faculty_abbr ?? "";
                return leftFaculty.localeCompare(rightFaculty);
            });

        const flattenedSlots: PeriodGridSlot[] = [];

        for (const facultyId of facultyIds) {
            const facultyRule = periodRules.find((rule) => rule.facultyId === facultyId);
            const facultyAssignments = periodAssignments.filter((assignment) => assignment.faculty_id === facultyId);
            const facultyAbbr = facultyRule?.facultyAbbr ?? facultyAssignments[0]?.faculty_abbr ?? facultyById.get(facultyId)?.abbreviation ?? "—";
            const capacity = Math.max(facultyRule?.capacity ?? 0, facultyAssignments.length);

            for (let index = 0; index < capacity; index += 1) {
                const assignment = facultyAssignments[index];
                if (assignment) {
                    flattenedSlots.push({ kind: "assignment", key: assignment.id, assignment });
                    continue;
                }

                if (facultyRule) {
                    flattenedSlots.push({
                        kind: "vacancy",
                        key: `${base.id}|${date}|${period}|${facultyId}|vacancy-${index + 1}`,
                        facultyAbbr,
                        allocation: { baseId: base.id, baseCode: base.code, date, period, facultyId, facultyAbbr },
                    });
                }
            }
        }

        const overflowCount = Math.max(flattenedSlots.length - SLOT_LIMIT_PER_PERIOD, 0);
        const slots = flattenedSlots.slice(0, SLOT_LIMIT_PER_PERIOD);
        const preferredFaculty = filterFaculty ? facultyById.get(filterFaculty) : null;

        while (slots.length < SLOT_LIMIT_PER_PERIOD) {
            slots.push({
                kind: "open",
                key: `${base.id}|${date}|${period}|open-${slots.length + 1}`,
                period,
                allocation: {
                    baseId: base.id,
                    baseCode: base.code,
                    date,
                    period,
                    facultyId: preferredFaculty?.id ?? null,
                    facultyAbbr: preferredFaculty?.abbreviation ?? null,
                },
            });
        }

        return { slots, overflowCount };
    }, [assignmentsByBaseDate, facultyById, filterFaculty, filteredRules]);

    const activeAllocationFacultyId = allocation?.facultyId ?? allocFacultyId;

    const eligibleInterns = useMemo(() => {
        if (!allocation) return [];
        if (!activeAllocationFacultyId) return [];

        const query = allocSearch.trim().toLowerCase();
        const busyInternIds = new Set(
            assignments
                .filter((assignment) => assignment.date === allocation.date && assignment.period === allocation.period)
                .map((assignment) => assignment.intern_id),
        );

        return users
            .filter((user) => user.role === "INTERN" && user.isActive)
            .filter((user) => user.facultyId === activeAllocationFacultyId)
            .filter((user) => !busyInternIds.has(user.id))
            .filter((user) => !query || user.name.toLowerCase().includes(query))
            .sort((left, right) => left.name.localeCompare(right.name));
    }, [activeAllocationFacultyId, allocSearch, allocation, assignments, users]);

    async function openAllocation(slot: AllocationState) {
        await loadUsers();
        setAllocation(slot);
        setAllocFacultyId(slot.facultyId ?? "");
        setAllocInternId("");
        setAllocSearch("");
        setMessage(null);
    }

    async function createAssignment() {
        const facultyId = allocation?.facultyId ?? allocFacultyId;
        if (!allocation || !allocInternId || !facultyId) return;
        setAllocLoading(true);
        setMessage(null);

        try {
            const response = await fetch("/taximetro/api/assignments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    internId: allocInternId,
                    facultyId,
                    baseId: allocation.baseId,
                    date: allocation.date,
                    period: allocation.period,
                }),
            });
            const json = await response.json();
            if (!json.success) throw new Error(json.error ?? "Não foi possível alocar o interno.");
            setAllocation(null);
            setAllocFacultyId("");
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
                    <div className="min-w-[1260px]" style={{ display: "grid", gridTemplateColumns: "124px repeat(7, minmax(162px, 1fr))" }}>
                        <div className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Base</div>
                        {weekDates.map((date) => (
                            <div key={date} className={`border-b border-slate-200 px-2 py-2 text-center text-[11px] font-semibold ${date === today ? "bg-accent-50/60 text-accent-700" : "bg-slate-50 text-slate-500"}`}>
                                {DAY_LABEL_BY_KEY[getDayKey(date)]}<br />
                                <span className="font-normal">{formatDayMonth(date)}</span>
                            </div>
                        ))}

                        {rows.map((base) => (
                            <Fragment key={base.id}>
                                <div className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-2.5 py-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-base font-bold leading-none text-slate-900">{base.code}</span>
                                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${getBaseStyle(base.type).pill}`}>
                                            {getBaseStyle(base.type).label}
                                        </span>
                                    </div>
                                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{base.name}</p>
                                </div>

                                {weekDates.map((date) => {
                                    const periods = filterPeriod ? [filterPeriod] : PERIODS;

                                    return (
                                        <div key={`${base.id}|${date}`} className={`border-b border-slate-100 px-1.5 py-1.5 ${date === today ? "bg-accent-50/20" : ""}`}>
                                            <div className="grid gap-1.5">
                                                {periods.map((period) => {
                                                    const tone = getPeriodTone(period);
                                                    const { slots, overflowCount } = buildPeriodSlots(base, date, period);

                                                    return (
                                                        <div key={`${base.id}|${date}|${period}`} className={`rounded-xl border p-1.5 ${tone.shell}`}>
                                                            <div className={`mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${tone.meta}`}>
                                                                <span>{formatPeriod(period)}</span>
                                                                {overflowCount > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${tone.overflow}`}>+{overflowCount}</span>}
                                                            </div>

                                                            <div className="grid gap-1">
                                                                {slots.map((slot) => {
                                                                    if (slot.kind === "assignment") {
                                                                        return <AssignmentSlotCard key={slot.key} assignment={slot.assignment} period={period} onSelect={setSelectedAssignmentId} />;
                                                                    }

                                                                    if (slot.kind === "vacancy") {
                                                                        return <VacancySlotCard key={slot.key} facultyAbbr={slot.facultyAbbr} allocation={slot.allocation} period={period} onOpen={openAllocation} />;
                                                                    }

                                                                    return <OpenSlotCard key={slot.key} allocation={slot.allocation} period={period} onOpen={openAllocation} />;
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
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
        <div className="space-y-4">
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 shadow-sm backdrop-blur-sm">
                <div className="flex min-w-max flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
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

                    <label className="relative block w-52 shrink-0">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input value={searchIntern} onChange={(event) => setSearchIntern(event.target.value)} placeholder="Buscar interno" className="h-9 w-full rounded-xl border border-slate-200 bg-white/90 py-1.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white shadow-sm" />
                    </label>

                    <button
                        type="button"
                        onClick={() => setFilterBase("")}
                        className={`inline-flex items-center rounded-full px-2.5 py-1 font-medium transition-all ${!filterBase ? "bg-slate-900 text-white shadow-[0_10px_18px_rgba(15,23,42,0.18)]" : "bg-slate-100/90 text-slate-600 hover:bg-slate-200/80"}`}
                    >
                        Todas as bases
                    </button>

                    {baseToggleOptions.map((base) => {
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

            <div className="overflow-x-auto rounded-[28px] border border-slate-200 bg-white/82 px-4 py-3 shadow-[0_14px_28px_rgba(15,23,42,0.05)] backdrop-blur-sm">
                <div className="flex min-w-max items-center gap-1.5 text-xs">
                    {visibleFacultyOptions.map((faculty) => {
                        const active = filterFaculty === faculty.id;
                        return (
                            <button
                                key={faculty.id}
                                type="button"
                                onClick={() => setFilterFaculty(active ? "" : faculty.id)}
                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium transition-all ${active ? "border-slate-900 bg-slate-900 text-white shadow-[0_10px_18px_rgba(15,23,42,0.18)]" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"} ${active ? "scale-105" : filterFaculty ? "opacity-40" : ""}`}
                            >
                                <span className={`h-2 w-2 rounded-full ${active ? "bg-white" : "bg-slate-400"}`} />
                                {faculty.abbreviation}
                            </button>
                        );
                    })}

                    {visibleFacultyOptions.length > 0 && <span className="mx-1 text-slate-300">|</span>}
                    <button
                        type="button"
                        onClick={() => setFilterPeriod(filterPeriod === "DAY" ? "" : "DAY")}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-all ${filterPeriod === "DAY" ? "bg-stone-900 font-bold text-white ring-1 ring-stone-700/20 shadow-[0_10px_18px_rgba(28,25,23,0.16)] scale-105" : filterPeriod ? "opacity-35 text-slate-400" : "border border-stone-300 bg-[linear-gradient(135deg,rgba(248,243,235,0.92),rgba(226,211,189,0.88))] text-stone-700"}`}
                    >
                        <Sun className="h-3.5 w-3.5 text-current" strokeWidth={1.5} /> Diurno
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilterPeriod(filterPeriod === "NIGHT" ? "" : "NIGHT")}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-all ${filterPeriod === "NIGHT" ? "bg-sky-950 font-bold text-white ring-1 ring-sky-800/20 shadow-[0_10px_18px_rgba(15,23,42,0.22)] scale-105" : filterPeriod ? "opacity-35 text-slate-400" : "border border-sky-900/30 bg-[linear-gradient(135deg,rgba(31,58,99,0.9),rgba(10,25,47,0.96))] text-white"}`}
                    >
                        <Moon className="h-3.5 w-3.5 text-current" strokeWidth={1.5} /> Noturno
                    </button>
                </div>
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
                                <p className="text-sm text-slate-500">{allocation.baseCode} · {formatDayMonth(allocation.date)} · {formatPeriod(allocation.period)} · {allocation.facultyAbbr ?? "faculdade livre"}</p>
                            </div>
                            <button type="button" onClick={() => {
                                setAllocation(null);
                                setAllocFacultyId("");
                            }} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-4 w-4" /></button>
                        </div>

                        <div className="space-y-3 px-6 py-4">
                            {!allocation.facultyId && (
                                <div className="space-y-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Escolha a faculdade</p>
                                    <div className="flex flex-wrap gap-2">
                                        {allocationFacultyOptions.map((faculty) => {
                                            const active = allocFacultyId === faculty.id;
                                            return (
                                                <button
                                                    key={faculty.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setAllocFacultyId(faculty.id);
                                                        setAllocInternId("");
                                                    }}
                                                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${active ? "border-slate-900 bg-slate-900 text-white shadow-[0_10px_18px_rgba(15,23,42,0.18)] scale-105" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"} ${!active && allocFacultyId ? "opacity-45" : ""}`}
                                                >
                                                    <span className={`h-2 w-2 rounded-full ${active ? "bg-white" : "bg-slate-400"}`} />
                                                    {faculty.abbreviation}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <label className="relative block">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <input value={allocSearch} onChange={(event) => setAllocSearch(event.target.value)} disabled={!activeAllocationFacultyId} placeholder={activeAllocationFacultyId ? "Buscar interno da faculdade..." : "Escolha a faculdade primeiro"} className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60" />
                            </label>

                            <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
                                {loadingUsers ? (
                                    <div className="flex items-center justify-center py-8 text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando internos...</div>
                                ) : !activeAllocationFacultyId ? (
                                    <p className="py-8 text-center text-sm text-slate-400">Selecione a faculdade para listar os internos elegíveis.</p>
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
                            <button type="button" onClick={() => {
                                setAllocation(null);
                                setAllocFacultyId("");
                            }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
                            <button type="button" disabled={allocLoading || !allocInternId || !activeAllocationFacultyId} onClick={createAssignment} className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50">
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
                                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
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