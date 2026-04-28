"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Loader2, MapPin, Moon, Plus, Search, Sun, Trash2, X, Zap } from "lucide-react";
import { AdminManualAttendanceActions } from "@/components/admin-manual-attendance-actions";
import { StatusBadge } from "@/components/status-badge";
import { getBaseStyle, getFacultyStyle, baseViewIndex } from "@/lib/base-colors";
import { addDaysToDateStr, formatBrazilTime, localDateStr } from "@/lib/utils";

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
    isExtraShift: boolean;
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
    isVirtual?: boolean;
};

type UserRow = {
    id: string;
    name: string;
    isActive: boolean;
    isArchived?: boolean;
    role: string | null;
    facultyId: string | null;
    facultyAbbr: string | null;
    allRoles?: Array<{
        role: "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN";
        facultyId: string | null;
        facultyAbbr: string | null;
        baseId: string | null;
        baseCode: string | null;
    }>;
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
    shift: string | null;
    status: string;
    is_extra_shift: boolean;
    extra_shift_notes: string | null;
    notes: string | null;
    geo_valid: boolean | null;
    checkin_status: string | null;
    checkin_method: string | null;
    checkin_at: string | null;
    totp_validated_at: string | null;
    validated_by_name: string | null;
    checkout_at: string | null;
    checkout_confirmed_by_name: string | null;
    intern_observations: string | null;
    preceptor_observations: string | null;
    checkout_notes: string | null;
};

type AllocationState = {
    baseId: string;
    baseCode: string;
    baseType?: "USA" | "CENTRAL" | "CRL";
    baseName?: string;
    date: string;
    period: "DAY" | "NIGHT";
    facultyId: string | null;
    facultyAbbr: string | null;
    isExtraShift?: boolean;
};

type PeriodFocusState = {
    baseId: string;
    baseCode: string;
    baseName: string;
    date: string;
    period: "DAY" | "NIGHT";
};

type ScheduleScope = "all" | "usa" | "regulation" | "cru" | "crl";
type FacultyBadgeMode = "neutral" | "faculty";

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

const DAY_LONG_LABEL_BY_KEY: Record<(typeof DAYS)[number], string> = {
    MON: "Segunda",
    TUE: "Terça",
    WED: "Quarta",
    THU: "Quinta",
    FRI: "Sexta",
    SAT: "Sábado",
    SUN: "Domingo",
};

const SLOT_LIMIT_PER_PERIOD = 2;

type ActualPeriodGridSlot =
    | { kind: "assignment"; key: string; assignment: AssignmentDetail }
    | { kind: "vacancy"; key: string; allocation: AllocationState; facultyAbbr: string };

type VisiblePeriodGridSlot = ActualPeriodGridSlot | { kind: "open"; key: string; allocation: AllocationState };

type VisiblePeriodSlots = {
    slots: VisiblePeriodGridSlot[];
    overflowCount: number;
    hiddenHasVacancy: boolean;
};

function normalizeDateKey(date: string) {
    return date.slice(0, 10);
}

function getDayKey(date: string) {
    const normalizedDate = normalizeDateKey(date);
    const day = new Date(`${normalizedDate}T12:00:00Z`).getUTCDay();
    return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][day] as typeof DAYS[number] | "SUN";
}

function formatDayMonth(date: string) {
    const normalizedDate = normalizeDateKey(date);
    return new Date(`${normalizedDate}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatPeriod(period: "DAY" | "NIGHT", shift?: string | null) {
    if (shift === "MORNING") return "Manhã";
    if (shift === "AFTERNOON") return "Tarde";
    return period === "DAY" ? "Diurno" : "Noturno";
}

function formatAssignmentCardName(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[1]}`;
}

function getDatePhase(date: string) {
    const normalizedDate = normalizeDateKey(date);
    const today = localDateStr();
    if (normalizedDate < today) return "past" as const;
    if (normalizedDate > today) return "future" as const;
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

function getFacultyBadgeClass(facultyAbbr: string | null | undefined, mode: FacultyBadgeMode, period?: "DAY" | "NIGHT") {
    if (mode === "faculty") {
        return getFacultyStyle(facultyAbbr);
    }

    return getNeutralFacultyBadgeClass(period);
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
            metaLabel: "Sem checkin",
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
    return `${assignment.intern_name} • ${assignment.base_code} • ${formatPeriod(assignment.period, assignment.shift)} • check-in ${checkinText} • checkout ${checkoutText}`;
}

function AssignmentSlotCard({ assignment, period, onSelect, facultyBadgeMode = "neutral", showBaseCode = false }: { assignment: AssignmentDetail; period: "DAY" | "NIGHT"; onSelect: (id: string) => void; facultyBadgeMode?: FacultyBadgeMode; showBaseCode?: boolean }) {
    const visual = getAssignmentVisualState(assignment, period);
    const Icon = visual.icon;
    const facultyTone = getFacultyBadgeClass(assignment.faculty_abbr, facultyBadgeMode, visual.darkSurface ? "NIGHT" : undefined);
    const isExtra = assignment.is_extra_shift;
    const extraGlowStyle = isExtra ? getFacultyStyle(assignment.faculty_abbr) : null;

    return (
        <button
            type="button"
            onClick={() => onSelect(assignment.id)}
            className={`group relative flex min-h-[56px] w-full min-w-0 items-stretch justify-between gap-2 overflow-hidden rounded-xl px-2.5 py-2 text-left transition hover:-translate-y-[1px] hover:shadow-[0_12px_20px_rgba(15,23,42,0.12)] ${visual.cardClass} ${visual.animationClass} ${getMutedSlotClass(assignment.date, "assignment", assignment.status)} ${isExtra ? "extra-shift-card" : ""}`}
            title={getAssignmentCardTitle(assignment) + (isExtra ? " (Plantão Extra)" : "")}
            style={isExtra && extraGlowStyle ? { boxShadow: `0 0 8px 2px ${extraGlowStyle.glowColor ?? "rgba(99,102,241,0.6)"}` } : undefined}
        >
            {isExtra && <span className="pointer-events-none absolute inset-0 extra-shift-shimmer" />}
            {isExtra && (
                <span className="absolute right-1 top-1 z-10 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">EXTRA</span>
            )}
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold leading-tight">{formatAssignmentCardName(assignment.intern_name)}</span>
                <span className="mt-1 flex items-center gap-2">
                    <span className={`inline-flex max-w-[84px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${facultyTone.pill}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${facultyTone.dot}`} />
                        <span className="truncate">{assignment.faculty_abbr}</span>
                    </span>
                    {assignment.shift && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${assignment.shift === "MORNING" ? "bg-amber-100 text-amber-800" : "bg-orange-100 text-orange-800"}`}>
                            {assignment.shift === "MORNING" ? "☀️ M" : "🌤️ T"}
                        </span>
                    )}
                    {showBaseCode && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${visual.darkSurface ? "border border-white/10 bg-white/8 text-white/72" : "border border-stone-300 bg-white/70 text-stone-600"}`}>{assignment.base_code}</span>}
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

function VacancySlotCard({ facultyAbbr, allocation, period, onOpen, onPublishExtra, facultyBadgeMode = "neutral", showBaseCode = false, isVirtual = false }: { facultyAbbr: string; allocation: AllocationState; period: "DAY" | "NIGHT"; onOpen: (slot: AllocationState) => void; onPublishExtra?: (slot: AllocationState) => void; facultyBadgeMode?: FacultyBadgeMode; showBaseCode?: boolean; isVirtual?: boolean }) {
    const tone = getPeriodTone(period);
    const facultyTone = getFacultyBadgeClass(facultyAbbr, facultyBadgeMode, period === "NIGHT" ? "NIGHT" : undefined);

    if (isVirtual) {
        return (
            <div
                className={`flex min-h-[56px] w-full min-w-0 items-center justify-between gap-2 rounded-xl border px-2.5 py-2 ${tone.shell} ${getMutedSlotClass(allocation.date, "vacancy")}`}
                title={`Reservado — ${facultyAbbr}`}
            >
                <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-black uppercase tracking-[0.16em] opacity-60">Reservado</span>
                    <span className="mt-1 flex items-center gap-2">
                        <span className={`inline-flex max-w-[84px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${facultyTone.pill}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${facultyTone.dot}`} />
                            <span className="truncate">{facultyAbbr}</span>
                        </span>
                        {showBaseCode && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${period === "NIGHT" ? "border border-white/10 bg-white/8 text-white/72" : "border border-stone-300 bg-white/70 text-stone-600"}`}>{allocation.baseCode}</span>}
                    </span>
                </span>
            </div>
        );
    }

    return (
        <div className={`flex min-h-[56px] w-full min-w-0 items-stretch gap-1.5 ${getMutedSlotClass(allocation.date, "vacancy")}`}>
            <button
                type="button"
                onClick={() => onOpen(allocation)}
                className={`flex flex-1 min-w-0 items-center gap-2 rounded-xl border border-dashed px-2.5 py-2 text-left transition hover:-translate-y-[1px] hover:shadow-[0_12px_20px_rgba(15,23,42,0.1)] ${tone.ghost}`}
                title={`Alocar interno em ${facultyAbbr}`}
            >
                <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-black uppercase tracking-[0.16em] opacity-75">Vaga</span>
                    <span className="mt-1 flex items-center gap-2">
                        <span className={`inline-flex max-w-[84px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${facultyTone.pill}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${facultyTone.dot}`} />
                            <span className="truncate">{facultyAbbr}</span>
                        </span>
                        {showBaseCode && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${period === "NIGHT" ? "border border-white/10 bg-white/8 text-white/72" : "border border-stone-300 bg-white/70 text-stone-600"}`}>{allocation.baseCode}</span>}
                    </span>
                </span>
                <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${tone.action}`}>
                    <Plus className="h-4 w-4" />
                </span>
            </button>
            {onPublishExtra && (
                <button
                    type="button"
                    onClick={() => onPublishExtra(allocation)}
                    className="inline-flex h-auto w-7 shrink-0 items-center justify-center rounded-xl border border-dashed border-amber-400/60 bg-amber-50 text-amber-600 transition hover:bg-amber-100 hover:text-amber-700"
                    title="Publicar como plantão extra"
                >
                    <Zap className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
            )}
        </div>
    );
}

function OpenSlotCard({ allocation, period, onOpen, onPublishExtra }: { allocation: AllocationState; period: "DAY" | "NIGHT"; onOpen: (slot: AllocationState) => void; onPublishExtra?: (slot: AllocationState) => void }) {
    const tone = getPeriodTone(period);

    return (
        <div className={`flex min-h-[56px] w-full min-w-0 items-stretch gap-1.5 ${getMutedSlotClass(allocation.date, "open")}`}>
        <button
            type="button"
            onClick={() => onOpen(allocation)}
            className={`flex flex-1 min-w-0 items-center justify-between gap-2 rounded-xl border border-dashed px-2.5 py-2 text-left transition hover:-translate-y-[1px] hover:shadow-[0_12px_20px_rgba(15,23,42,0.1)] ${tone.ghost}`}
            title="Alocação manual livre"
        >
            <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-black uppercase tracking-[0.16em] opacity-75">Livre</span>
                <span className={`mt-1 block truncate text-[10px] font-semibold uppercase tracking-[0.12em] ${tone.meta}`}>
                    Alocação manual
                </span>
            </span>
            <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${tone.action}`}>
                <Plus className="h-4 w-4" />
            </span>
        </button>
        {onPublishExtra && (
            <button
                type="button"
                onClick={() => onPublishExtra(allocation)}
                className="inline-flex h-auto w-7 shrink-0 items-center justify-center rounded-xl border border-dashed border-amber-400/60 bg-amber-50 text-amber-600 transition hover:bg-amber-100 hover:text-amber-700"
                title="Publicar como plantão extra"
            >
                <Zap className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
        )}
        </div>
    );
}

export function AdminFilledSchedule({ scope = "all" }: { scope?: ScheduleScope }) {
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
    const [filterDayKey, setFilterDayKey] = useState<"" | (typeof DAYS)[number]>("");
    const [filterPeriod, setFilterPeriod] = useState<"" | "DAY" | "NIGHT">("");
    const [filterMissingCheckin, setFilterMissingCheckin] = useState(false);
    const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
    const [allocation, setAllocation] = useState<AllocationState | null>(null);
    const [focusedPeriod, setFocusedPeriod] = useState<PeriodFocusState | null>(null);
    const [allocFacultyId, setAllocFacultyId] = useState("");
    const [allocCandidateFacultyFilter, setAllocCandidateFacultyFilter] = useState<string>("ALL");
    const [allocInternId, setAllocInternId] = useState("");
    const [allocSearch, setAllocSearch] = useState("");
    const [allocShift, setAllocShift] = useState<"MORNING" | "AFTERNOON" | "">("");
    const [allocLoading, setAllocLoading] = useState(false);
    const [allocIsExtraShift, setAllocIsExtraShift] = useState(false);
    const [allocExtraShiftNotes, setAllocExtraShiftNotes] = useState("");
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [publishExtraSlot, setPublishExtraSlot] = useState<AllocationState | null>(null);
    const [publishExtraNotes, setPublishExtraNotes] = useState("");
    const [publishExtraLoading, setPublishExtraLoading] = useState(false);
    const [publishExtraMessage, setPublishExtraMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    function hasRole(user: UserRow, role: "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN") {
        if (user.role === role) return true;
        return (user.allRoles ?? []).some((r) => r.role === role);
    }

    function getInternFacultyId(user: UserRow) {
        const internRole = (user.allRoles ?? []).find((r) => r.role === "INTERN");
        return internRole?.facultyId ?? user.facultyId;
    }

    function getInternFacultyAbbr(user: UserRow) {
        const internRole = (user.allRoles ?? []).find((r) => r.role === "INTERN");
        return internRole?.facultyAbbr ?? user.facultyAbbr;
    }

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
    const isRegulationScope = scope === "cru" || scope === "crl";
    const hasInternSearch = searchIntern.trim().length > 0;
    const hasStrictContentFilter = hasInternSearch || filterMissingCheckin;
    const hidesNight = scope === "crl";
    const scopePeriods: Array<"DAY" | "NIGHT"> = hidesNight ? ["DAY"] : PERIODS;
    const filteredWeekDates = useMemo(
        () => (filterDayKey ? weekDates.filter((date) => getDayKey(date) === filterDayKey) : weekDates),
        [filterDayKey, weekDates],
    );

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

    useEffect(() => {
        if (hidesNight && filterPeriod === "NIGHT") {
            setFilterPeriod("");
        }
    }, [filterPeriod, hidesNight]);

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
        return [...source].filter((f) => !f.isVirtual).sort((left, right) => left.abbreviation.localeCompare(right.abbreviation));
    }, [faculties, visibleFacultyOptions]);

    const filteredAssignments = useMemo(() => {
        const internQuery = searchIntern.trim().toLowerCase();
        return assignments.filter((assignment) => {
            if (filterBase && assignment.base_id !== filterBase) return false;
            if (filterFaculty && assignment.faculty_id !== filterFaculty) return false;
            if (filterPeriod && assignment.period !== filterPeriod) return false;
            if (
                filterMissingCheckin
                && !(assignment.status === "ABSENT" || (isPendingStatus(assignment.status) && assignment.date <= today))
            ) return false;
            if (internQuery && !assignment.intern_name.toLowerCase().includes(internQuery)) return false;
            return true;
        });
    }, [assignments, filterBase, filterFaculty, filterMissingCheckin, filterPeriod, searchIntern, today]);

    const filteredRules = useMemo(() => {
        if (filterMissingCheckin) return [];

        return rules.filter((rule) => {
            if (filterBase && rule.baseId !== filterBase) return false;
            if (filterFaculty && rule.facultyId !== filterFaculty) return false;
            if (filterPeriod && rule.period !== filterPeriod) return false;
            return true;
        });
    }, [filterBase, filterFaculty, filterMissingCheckin, filterPeriod, rules]);

    const cruConflicts = useMemo(() => {
        const blocked = new Set<string>();

        for (const assignment of assignments) {
            if (assignment.status === "CANCELLED") continue;
            if (assignment.base_code !== "CRU" && assignment.base_code !== "CRL") continue;

            const dateKey = normalizeDateKey(assignment.date);
            blocked.add(`${assignment.intern_id}|${dateKey}|${assignment.period}`);

            if (assignment.period === "DAY") {
                blocked.add(`${assignment.intern_id}|${addDaysToDateStr(dateKey, -1)}|NIGHT`);
                blocked.add(`${assignment.intern_id}|${dateKey}|NIGHT`);
                continue;
            }

            blocked.add(`${assignment.intern_id}|${dateKey}|DAY`);
            blocked.add(`${assignment.intern_id}|${addDaysToDateStr(dateKey, 1)}|DAY`);
        }

        return blocked;
    }, [assignments]);

    const assignmentsByBaseDate = useMemo(() => {
        const map = new Map<string, AssignmentDetail[]>();
        for (const assignment of filteredAssignments) {
            const key = `${assignment.base_id}|${normalizeDateKey(assignment.date)}`;
            const rows = map.get(key) ?? [];
            rows.push(assignment);
            map.set(key, rows);
        }
        return map;
    }, [filteredAssignments]);

    const visibleBases = useMemo(() => {
        const hasContent = (base: Base) => filteredWeekDates.some((date) => {
            const dayKey = getDayKey(date);
            const rulesForDay = filteredRules.filter((rule) => rule.baseId === base.id && rule.dayOfWeek === dayKey);
            const assignmentsForDay = assignmentsByBaseDate.get(`${base.id}|${date}`) ?? [];
            if (isRegulationScope && hasStrictContentFilter) {
                return assignmentsForDay.length > 0;
            }
            return rulesForDay.length > 0 || assignmentsForDay.length > 0;
        });

        const matchesScope = (base: Base) => {
            if (scope === "usa") return base.type === "USA";
            if (scope === "regulation") return base.type === "CENTRAL" || base.type === "CRL";
            if (scope === "cru") return base.type === "CENTRAL";
            if (scope === "crl") return base.type === "CRL";
            return true;
        };

        return bases
            .filter((base) => matchesScope(base))
            .filter((base) => !filterBase || base.id === filterBase)
            .filter((base) => (hasStrictContentFilter ? hasContent(base) : true))
            .sort((left, right) => {
                if (left.type !== right.type) {
                    const rank = (type: Base["type"]) => (type === "USA" ? 0 : type === "CENTRAL" ? 1 : 2);
                    return rank(left.type) - rank(right.type);
                }
                return baseViewIndex(left.code) - baseViewIndex(right.code) || left.code.localeCompare(right.code);
            });
    }, [assignmentsByBaseDate, bases, filterBase, filteredRules, filteredWeekDates, hasStrictContentFilter, isRegulationScope, scope]);

    const usaBases = visibleBases.filter((base) => base.type === "USA");
    const regulationBases = visibleBases.filter((base) => base.type !== "USA");
    const cruBases = visibleBases.filter((base) => base.type === "CENTRAL");
    const crlBases = visibleBases.filter((base) => base.type === "CRL");

    const baseToggleOptions = useMemo(() => {
        return [...bases]
            .filter((base) => {
                if (scope === "usa") return base.type === "USA";
                if (scope === "regulation") return base.type === "CENTRAL" || base.type === "CRL";
                if (scope === "cru") return base.type === "CENTRAL";
                if (scope === "crl") return base.type === "CRL";
                return true;
            })
            .sort((left, right) => {
                if (left.type !== right.type) {
                    const rank = (type: Base["type"]) => (type === "USA" ? 0 : type === "CENTRAL" ? 1 : 2);
                    return rank(left.type) - rank(right.type);
                }
                return baseViewIndex(left.code) - baseViewIndex(right.code) || left.code.localeCompare(right.code);
            });
    }, [bases, scope]);

    const selectedAssignment = useMemo(
        () => assignments.find((assignment) => assignment.id === selectedAssignmentId) ?? null,
        [assignments, selectedAssignmentId],
    );

    const getPeriodSlots = useCallback((base: Base, date: string, period: "DAY" | "NIGHT") => {
        const dayKey = getDayKey(date);
        const cellAssignments = assignmentsByBaseDate.get(`${base.id}|${normalizeDateKey(date)}`) ?? [];
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

        const flattenedSlots: ActualPeriodGridSlot[] = [];

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
                        allocation: { baseId: base.id, baseCode: base.code, baseType: base.type, date, period, facultyId, facultyAbbr, isExtraShift: facultyRule?.isExtraShift },
                    });
                }
            }
        }

        return flattenedSlots;
    }, [assignmentsByBaseDate, facultyById, filterFaculty, filteredRules]);

    const buildVisiblePeriodSlots = useCallback((base: Base, date: string, period: "DAY" | "NIGHT", visibleLimit = SLOT_LIMIT_PER_PERIOD): VisiblePeriodSlots => {
        const allSlots = getPeriodSlots(base, date, period);
        const visibleSlots: ActualPeriodGridSlot[] = visibleLimit >= allSlots.length ? [...allSlots] : allSlots.slice(0, visibleLimit);
        const hiddenSlots = visibleLimit >= allSlots.length ? [] : allSlots.slice(visibleLimit);

        if (!visibleSlots.some((slot) => slot.kind === "vacancy")) {
            const hiddenVacancyIndex = hiddenSlots.findIndex((slot) => slot.kind === "vacancy");
            const replaceIndex = visibleSlots.findIndex((slot) => slot.kind === "assignment");

            if (hiddenVacancyIndex !== -1 && replaceIndex !== -1) {
                const replacement = hiddenSlots[hiddenVacancyIndex];
                hiddenSlots[hiddenVacancyIndex] = visibleSlots[replaceIndex];
                visibleSlots[replaceIndex] = replacement;
            }
        }

        const paddedSlots: VisiblePeriodGridSlot[] = [...visibleSlots];

        while (!hasStrictContentFilter && paddedSlots.length < visibleLimit) {
            paddedSlots.push({
                kind: "open",
                key: `${base.id}|${date}|${period}|open-${paddedSlots.length + 1}`,
                allocation: {
                    baseId: base.id,
                    baseCode: base.code,
                    baseType: base.type,
                    baseName: base.name,
                    date,
                    period,
                    facultyId: null,
                    facultyAbbr: null,
                },
            });
        }

        return {
            slots: paddedSlots,
            overflowCount: hiddenSlots.length,
            hiddenHasVacancy: hiddenSlots.some((slot) => slot.kind === "vacancy"),
        };
    }, [getPeriodSlots, hasStrictContentFilter]);

    const focusedPeriodBase = useMemo(
        () => (focusedPeriod ? bases.find((base) => base.id === focusedPeriod.baseId) ?? null : null),
        [bases, focusedPeriod],
    );

    const focusedPeriodSlots = useMemo(() => {
        if (!focusedPeriod || !focusedPeriodBase) return [];
        return getPeriodSlots(focusedPeriodBase, focusedPeriod.date, focusedPeriod.period);
    }, [focusedPeriod, focusedPeriodBase, getPeriodSlots]);

    const selectedAllocUser = useMemo(
        () => (allocInternId ? users.find((user) => user.id === allocInternId) ?? null : null),
        [allocInternId, users],
    );

    const assignmentFacultyId = allocation?.facultyId ?? allocFacultyId ?? selectedAllocUser?.facultyId ?? "";
    const activeCandidateFacultyFilter = allocCandidateFacultyFilter === "ALL" ? null : allocCandidateFacultyFilter;
    const isRetroactiveAdminAllocation = Boolean(allocation && allocation.date < localDateStr());
    const isManualOpenAllocation = Boolean(allocation && allocation.facultyId === null);

    const allocationCandidates = useMemo(() => {
        if (!allocation) {
            return { eligibleInterns: [], blockedCount: 0, busyCount: 0 };
        }

        const query = allocSearch.trim().toLowerCase();
        const isCruShiftAlloc = allocation.baseType === "CENTRAL" && allocation.period === "DAY" && allocShift;
        const busyInternIds = new Set(
            assignments
                .filter((assignment) => {
                    if (assignment.date !== allocation.date || assignment.period !== allocation.period) return false;
                    // For CRU shift allocation, only block if same shift is already taken
                    if (isCruShiftAlloc && assignment.base_type === "CENTRAL") {
                        return assignment.shift === allocShift;
                    }
                    return true;
                })
                .map((assignment) => assignment.intern_id),
        );

        let blockedCount = 0;
        let busyCount = 0;

        const eligibleInterns = users
            .filter((user) => hasRole(user, "INTERN") && user.isActive && !user.isArchived)
            .filter((user) => !activeCandidateFacultyFilter || getInternFacultyId(user) === activeCandidateFacultyFilter)
            .filter((user) => {
                if (busyInternIds.has(user.id)) {
                    busyCount += 1;
                    return false;
                }

                // CRU/CRL targets are exempt from ±12h conflict (only blocks USA)
                const isTargetCru = allocation.baseType === "CENTRAL" || allocation.baseCode === "CRL";
                if (!isTargetCru && !isRetroactiveAdminAllocation && cruConflicts.has(`${user.id}|${allocation.date}|${allocation.period}`)) {
                    blockedCount += 1;
                    return false;
                }

                return true;
            })
            .filter((user) => !query || user.name.toLowerCase().includes(query))
            .sort((left, right) => {
                const preferredFacultyId = allocation.facultyId ?? activeCandidateFacultyFilter;
                const leftSameFaculty = getInternFacultyId(left) === preferredFacultyId;
                const rightSameFaculty = getInternFacultyId(right) === preferredFacultyId;

                if (leftSameFaculty !== rightSameFaculty) {
                    return leftSameFaculty ? -1 : 1;
                }

                const leftFaculty = getInternFacultyAbbr(left) ?? "";
                const rightFaculty = getInternFacultyAbbr(right) ?? "";
                const byFaculty = leftFaculty.localeCompare(rightFaculty);
                if (byFaculty !== 0) return byFaculty;

                return left.name.localeCompare(right.name);
            });

        return { eligibleInterns, blockedCount, busyCount };
    }, [activeCandidateFacultyFilter, allocSearch, allocShift, allocation, assignments, cruConflicts, isRetroactiveAdminAllocation, users]);

    function openPublishExtra(slot: AllocationState) {
        setPublishExtraSlot(slot);
        setPublishExtraNotes("");
        setPublishExtraMessage(null);
    }

    async function submitPublishExtra() {
        if (!publishExtraSlot) return;
        setPublishExtraLoading(true);
        setPublishExtraMessage(null);
        try {
            const response = await fetch("/taximetro/api/extra-offers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    baseId: publishExtraSlot.baseId,
                    date: publishExtraSlot.date,
                    period: publishExtraSlot.period,
                    facultyId: publishExtraSlot.facultyId ?? null,
                    notes: publishExtraNotes || null,
                }),
            });
            const json = await response.json();
            if (!json.success) throw new Error(json.error ?? "Erro ao publicar extra");
            setPublishExtraMessage({ type: "success", text: "Plantão extra publicado no board!" });
            setTimeout(() => setPublishExtraSlot(null), 1200);
        } catch (error) {
            setPublishExtraMessage({ type: "error", text: error instanceof Error ? error.message : "Erro ao publicar extra" });
        } finally {
            setPublishExtraLoading(false);
        }
    }

    async function openAllocation(slot: AllocationState) {
        await loadUsers();
        setAllocation(slot);
        setAllocFacultyId(slot.facultyId ?? "");
        setAllocCandidateFacultyFilter(slot.facultyId ?? "ALL");
        setAllocInternId("");
        setAllocSearch("");
        setAllocIsExtraShift(slot.isExtraShift ?? false);
        setAllocExtraShiftNotes("");
        const isCruShift = slot.baseType === "CENTRAL" && slot.period === "DAY"
            && (slot.facultyAbbr === "EBMSP" || faculties.find(f => f.id === slot.facultyId)?.abbreviation === "EBMSP");
        setAllocShift(isCruShift ? "MORNING" : "");
        setMessage(null);
    }

    async function createAssignment() {
        const facultyId = assignmentFacultyId;
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
                    shift: allocShift || null,
                    allowRetroactiveOverride: isRetroactiveAdminAllocation,
                    allowAdminOpenAllocation: isManualOpenAllocation,
                    isExtraShift: allocIsExtraShift,
                    extraShiftNotes: allocIsExtraShift ? allocExtraShiftNotes || null : null,
                }),
            });
            const json = await response.json();
            if (!json.success) throw new Error(json.error ?? "Não foi possível alocar o interno.");
            setAllocation(null);
            setFocusedPeriod(null);
            setAllocFacultyId("");
            setAllocCandidateFacultyFilter("ALL");
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
                        {filteredWeekDates.map((date) => (
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

                                {filteredWeekDates.map((date) => {
                                    const periods = filterPeriod ? [filterPeriod] : scopePeriods;

                                    return (
                                        <div key={`${base.id}|${date}`} className={`border-b border-slate-100 px-1.5 py-1.5 ${date === today ? "bg-accent-50/20" : ""}`}>
                                            <div className="grid gap-1.5">
                                                {periods.map((period) => {
                                                    const tone = getPeriodTone(period);
                                                    const { slots, overflowCount, hiddenHasVacancy } = buildVisiblePeriodSlots(base, date, period);

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
                                                                        return <VacancySlotCard key={slot.key} facultyAbbr={slot.facultyAbbr} allocation={slot.allocation} period={period} onOpen={openAllocation} onPublishExtra={openPublishExtra} isVirtual={facultyById.get(slot.allocation.facultyId ?? "")?.isVirtual} />;
                                                                    }

                                                                    return <OpenSlotCard key={slot.key} allocation={slot.allocation} period={period} onOpen={openAllocation} onPublishExtra={openPublishExtra} />;
                                                                })}

                                                                {overflowCount > 0 && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setFocusedPeriod({
                                                                            baseId: base.id,
                                                                            baseCode: base.code,
                                                                            baseName: base.name,
                                                                            date,
                                                                            period,
                                                                        })}
                                                                        className={`flex w-full items-center justify-between rounded-xl border border-dashed px-2.5 py-2 text-left text-[11px] font-semibold transition hover:-translate-y-[1px] ${tone.ghost}`}
                                                                    >
                                                                        <span>
                                                                            Ver +{overflowCount} item(ns)
                                                                            {hiddenHasVacancy ? " e vagas" : ""}
                                                                        </span>
                                                                        <Plus className="h-3.5 w-3.5" />
                                                                    </button>
                                                                )}
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

    function renderRegulationFacultySection(title: string, rows: Base[]) {
        if (rows.length === 0) return null;

        const showBaseCode = rows.length > 1;
        const periods = filterPeriod ? [filterPeriod] : scopePeriods;
        const visibleDateCards = filteredWeekDates.map((date) => {
            const periodCards = periods.map((period) => {
                const tone = getPeriodTone(period);
                const facultyGroups = rows.flatMap((base) => {
                    const slots = getPeriodSlots(base, date, period);
                    const visibleSlots = hasInternSearch
                        ? slots.filter((slot) => slot.kind === "assignment")
                        : slots;
                    return visibleSlots.map((slot) => ({ base, slot }));
                }).reduce((map, item) => {
                    const facultyAbbr = item.slot.kind === "assignment"
                        ? item.slot.assignment.faculty_abbr
                        : item.slot.facultyAbbr;

                    const rowsForFaculty = map.get(facultyAbbr) ?? [];
                    rowsForFaculty.push(item);
                    map.set(facultyAbbr, rowsForFaculty);
                    return map;
                }, new Map<string, Array<{ base: Base; slot: ActualPeriodGridSlot }>>());

                const orderedFaculties = [...facultyGroups.entries()]
                    .sort(([left], [right]) => left.localeCompare(right))
                    .map(([facultyAbbr, items]) => ({
                        facultyAbbr,
                        items: [...items].sort((left, right) => {
                            const leftName = left.slot.kind === "assignment" ? left.slot.assignment.intern_name : "zzzzzz";
                            const rightName = right.slot.kind === "assignment" ? right.slot.assignment.intern_name : "zzzzzz";
                            if (leftName !== rightName) return leftName.localeCompare(rightName);
                            return left.base.code.localeCompare(right.base.code);
                        }),
                    }));

                if (orderedFaculties.length === 0) {
                    return null;
                }

                return (
                    <div key={`${date}|${period}`} className={`rounded-2xl border p-3 ${tone.shell}`}>
                        <div className={`mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${tone.meta}`}>
                            {period === "DAY" ? <Sun className="h-3.5 w-3.5" strokeWidth={1.8} /> : <Moon className="h-3.5 w-3.5" strokeWidth={1.8} />}
                            <span>{formatPeriod(period)}</span>
                        </div>

                        <div className="space-y-3">
                            {orderedFaculties.map(({ facultyAbbr, items }) => {
                                const facultyTone = getFacultyStyle(facultyAbbr);
                                return (
                                    <div key={`${date}|${period}|${facultyAbbr}`} className="rounded-xl border border-black/5 bg-white/45 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${facultyTone.pill}`}>
                                                <span className={`h-2 w-2 rounded-full ${facultyTone.dot}`} />
                                                {facultyAbbr}
                                            </span>
                                            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">{items.length} item(ns)</span>
                                        </div>

                                        <div className="grid gap-2">
                                            {items.map(({ slot }) => {
                                                if (slot.kind === "assignment") {
                                                    return <AssignmentSlotCard key={slot.key} assignment={slot.assignment} period={period} onSelect={setSelectedAssignmentId} facultyBadgeMode="faculty" showBaseCode={showBaseCode} />;
                                                }

                                                if (slot.kind === "vacancy") {
                                                    return <VacancySlotCard key={slot.key} facultyAbbr={slot.facultyAbbr} allocation={slot.allocation} period={period} onOpen={openAllocation} onPublishExtra={openPublishExtra} facultyBadgeMode="faculty" showBaseCode={showBaseCode} isVirtual={facultyById.get(slot.allocation.facultyId ?? "")?.isVirtual} />;
                                                }
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            }).filter(Boolean);

            if (periodCards.length === 0) {
                return null;
            }

            return (
                <article key={date} className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${date === today ? "ring-1 ring-accent-300" : ""}`}>
                    <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                        <div>
                            <p className="text-sm font-semibold text-slate-900">{DAY_LABEL_BY_KEY[getDayKey(date)]}</p>
                            <p className="text-xs text-slate-500">{formatDayMonth(date)}</p>
                        </div>
                        {date === today && <span className="rounded-full bg-accent-50 px-2.5 py-1 text-[10px] font-semibold text-accent-700">Hoje</span>}
                    </div>

                    <div className="space-y-4">{periodCards}</div>
                </article>
            );
        }).filter(Boolean);

        return (
            <section className="space-y-4">
                <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
                    <span className="text-xs text-slate-400">ordem por faculdade e nome</span>
                </div>

                <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                    {visibleDateCards}
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
                <div className="flex min-w-max flex-wrap items-center gap-1.5 text-xs">
                    <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Dia</span>
                    <button
                        type="button"
                        onClick={() => setFilterDayKey("")}
                        className={`inline-flex items-center rounded-full px-2.5 py-1 transition-all ${!filterDayKey ? "bg-slate-900 text-white shadow-[0_10px_18px_rgba(15,23,42,0.18)] scale-105" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                    >
                        Semana toda
                    </button>
                    {DAYS.map((dayKey) => {
                        const active = filterDayKey === dayKey;
                        const dayDate = weekDates.find((date) => getDayKey(date) === dayKey);
                        const isToday = dayDate === today;

                        return (
                            <button
                                key={dayKey}
                                type="button"
                                onClick={() => setFilterDayKey(active ? "" : dayKey)}
                                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-all ${active ? "bg-accent-600 text-white shadow-[0_10px_18px_rgba(2,132,199,0.22)] scale-105" : isToday ? "border border-accent-300 bg-accent-50 text-accent-700 hover:bg-accent-100" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                                title={DAY_LONG_LABEL_BY_KEY[dayKey]}
                            >
                                <span className="font-semibold">{DAY_LABEL_BY_KEY[dayKey]}</span>
                                {dayDate && <span className={`text-[10px] ${active ? "text-white/80" : "text-slate-400"}`}>{formatDayMonth(dayDate)}</span>}
                            </button>
                        );
                    })}

                    <span className="mx-1 text-slate-300">|</span>
                    {visibleFacultyOptions.map((faculty) => {
                        const active = filterFaculty === faculty.id;
                        const facultyTone = getFacultyStyle(faculty.abbreviation);
                        return (
                            <button
                                key={faculty.id}
                                type="button"
                                onClick={() => setFilterFaculty(active ? "" : faculty.id)}
                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium transition-all ${active ? `${facultyTone.pill} shadow-[0_10px_18px_rgba(15,23,42,0.12)]` : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"} ${active ? "scale-105" : filterFaculty ? "opacity-40" : ""}`}
                            >
                                <span className={`h-2 w-2 rounded-full ${active ? facultyTone.dot : "bg-slate-400"}`} />
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
                    {!hidesNight && (
                        <button
                            type="button"
                            onClick={() => setFilterPeriod(filterPeriod === "NIGHT" ? "" : "NIGHT")}
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-all ${filterPeriod === "NIGHT" ? "bg-sky-950 font-bold text-white ring-1 ring-sky-800/20 shadow-[0_10px_18px_rgba(15,23,42,0.22)] scale-105" : filterPeriod ? "opacity-35 text-slate-400" : "border border-sky-900/30 bg-[linear-gradient(135deg,rgba(31,58,99,0.9),rgba(10,25,47,0.96))] text-white"}`}
                        >
                            <Moon className="h-3.5 w-3.5 text-current" strokeWidth={1.5} /> Noturno
                        </button>
                    )}
                    <span className="mx-1 text-slate-300">|</span>
                    <button
                        type="button"
                        onClick={() => setFilterMissingCheckin((current) => !current)}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-all ${filterMissingCheckin ? "bg-red-700 font-semibold text-white shadow-[0_10px_18px_rgba(127,29,29,0.24)] scale-105" : "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"}`}
                        title="Mostrar apenas plantões sem check-in validado ou com falta"
                    >
                        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.7} /> Ausência / sem check-in
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
                    {(scope === "all" || scope === "usa") && renderBaseSection("USA — Bases × Dia", usaBases)}
                    {(scope === "all" || scope === "regulation") && renderBaseSection("Regulação — CRU / CRL", regulationBases)}
                    {scope === "cru" && renderRegulationFacultySection("CRU — Regulação", cruBases)}
                    {scope === "crl" && renderRegulationFacultySection("CRL", crlBases)}
                    {visibleBases.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">Nenhuma alocação ou vaga encontrada para os filtros da semana.</div>}
                </div>
            )}

            {allocation && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAllocation(null)}>
                    <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
                            <div>
                                <h3 className="text-lg font-semibold text-slate-900">Alocar interno na vaga</h3>
                                <p className="text-sm text-slate-500">{allocation.baseCode} · {formatDayMonth(allocation.date)} · {formatPeriod(allocation.period, allocShift || null)} · {allocation.facultyAbbr ?? "faculdade livre"}</p>
                            </div>
                            <button type="button" onClick={() => {
                                setAllocation(null);
                                setAllocFacultyId("");
                            }} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-4 w-4" /></button>
                        </div>

                        <div className="space-y-3 px-6 py-4">
                            <div className="space-y-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pesquisar internos por faculdade</p>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAllocCandidateFacultyFilter("ALL");
                                            setAllocInternId("");
                                        }}
                                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${allocCandidateFacultyFilter === "ALL" ? "border-slate-900 bg-slate-900 text-white shadow-[0_10px_18px_rgba(15,23,42,0.18)] scale-105" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                                    >
                                        Todas
                                    </button>
                                    {allocationFacultyOptions.map((faculty) => {
                                        const active = allocCandidateFacultyFilter === faculty.id;
                                        return (
                                            <button
                                                key={faculty.id}
                                                type="button"
                                                onClick={() => {
                                                    setAllocCandidateFacultyFilter(faculty.id);
                                                    setAllocInternId("");
                                                    if (!allocation.facultyId) {
                                                        setAllocFacultyId(faculty.id);
                                                    }
                                                }}
                                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${active ? "border-slate-900 bg-slate-900 text-white shadow-[0_10px_18px_rgba(15,23,42,0.18)] scale-105" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                                            >
                                                <span className={`h-2 w-2 rounded-full ${active ? "bg-white" : "bg-slate-400"}`} />
                                                {faculty.abbreviation}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <label className="relative block">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <input value={allocSearch} onChange={(event) => setAllocSearch(event.target.value)} placeholder={activeCandidateFacultyFilter ? "Buscar pelo nome dentro da faculdade" : "Buscar qualquer interno ativo"} className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white" />
                            </label>

                            {allocation.baseType === "CENTRAL" && allocation.period === "DAY" && (allocation.facultyAbbr === "EBMSP" || faculties.find(f => f.id === assignmentFacultyId)?.abbreviation === "EBMSP") && (
                                <div>
                                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Turno CRU (EBMSP)</p>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setAllocShift("MORNING")}
                                            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${allocShift === "MORNING" ? "bg-amber-100 text-amber-800 ring-2 ring-amber-400" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                                        >
                                            ☀️ Manhã (07h–13h)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setAllocShift("AFTERNOON")}
                                            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${allocShift === "AFTERNOON" ? "bg-orange-100 text-orange-800 ring-2 ring-orange-400" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                                        >
                                            🌤️ Tarde (13h–19h)
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className={`rounded-xl px-3 py-2 text-xs ${isRetroactiveAdminAllocation ? "border border-sky-200 bg-sky-50 text-sky-800" : "border border-slate-200 bg-slate-50 text-slate-600"}`}>
                                {allocation.facultyId
                                    ? `Vaga reservada para ${allocation.facultyAbbr}. O plantão continuará contando como ${allocation.facultyAbbr}, mas você pode procurar internos de outras faculdades ou abrir “Todas”.`
                                    : "Vaga livre: o plantão assumirá a faculdade do interno selecionado."}
                                {isRetroactiveAdminAllocation ? " Edição retroativa segue liberada para a coordenação e fica auditada." : ""}
                            </div>

                            {assignmentFacultyId && (
                                <div className={`rounded-xl px-3 py-2 text-xs ${isRetroactiveAdminAllocation ? "border border-sky-200 bg-sky-50 text-sky-800" : "border border-slate-200 bg-slate-50 text-slate-600"}`}>
                                    Faculdade que será registrada no plantão: {faculties.find((faculty) => faculty.id === assignmentFacultyId)?.abbreviation ?? selectedAllocUser?.facultyAbbr ?? "—"}
                                </div>
                            )}

                            {/* Extra Shift toggle */}
                            <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/50 px-3 py-2">
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={allocIsExtraShift}
                                        onChange={(event) => setAllocIsExtraShift(event.target.checked)}
                                        className="h-4 w-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="text-sm font-medium text-indigo-900">Este é um plantão extra</span>
                                </label>
                                <span className="text-[10px] text-indigo-600">Não conta para o rodízio</span>
                            </div>
                            {allocIsExtraShift && (
                                <div className="space-y-1">
                                    <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Notas (opcional)</label>
                                    <input
                                        type="text"
                                        value={allocExtraShiftNotes}
                                        onChange={(event) => setAllocExtraShiftNotes(event.target.value)}
                                        placeholder="Ex: Cobertura de evento SAMU"
                                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    />
                                </div>
                            )}

                            <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
                                {loadingUsers ? (
                                    <div className="flex items-center justify-center py-8 text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando internos...</div>
                                ) : allocationCandidates.eligibleInterns.length === 0 ? (
                                    <p className="py-8 text-center text-sm text-slate-400">
                                        Nenhum interno elegível nesta vaga.
                                        {!isRetroactiveAdminAllocation && allocationCandidates.blockedCount > 0 ? ` ${allocationCandidates.blockedCount} bloqueado(s) por conflito CRU/CRL ±12h.` : ""}
                                    </p>
                                ) : (
                                    allocationCandidates.eligibleInterns.map((user) => (
                                        <button
                                            key={user.id}
                                            type="button"
                                            onClick={() => {

                            {/* ─────────── Publish Extra Offer Modal ─────────── */}
                            {publishExtraSlot && (
                                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPublishExtraSlot(null)}>
                                    <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                                        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                                            <div className="flex items-center gap-2">
                                                <Zap className="h-4 w-4 text-amber-500" strokeWidth={2.2} />
                                                <h2 className="text-sm font-bold text-slate-900">Publicar como Plantão Extra</h2>
                                            </div>
                                            <button type="button" onClick={() => setPublishExtraSlot(null)} className="rounded-lg p-1 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
                                        </div>
                                        <div className="space-y-4 px-5 py-4">
                                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                                                ⚠️ <strong>Atenção:</strong> Este plantão extra <strong>não contabiliza carga horária obrigatória</strong>. Qualquer interno da base poderá reivindicar por ordem de chegada.
                                            </div>
                                            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                                                <p><span className="font-semibold">Base:</span> {publishExtraSlot.baseCode}</p>
                                                <p><span className="font-semibold">Data:</span> {publishExtraSlot.date}</p>
                                                <p><span className="font-semibold">Turno:</span> {formatPeriod(publishExtraSlot.period)}</p>
                                                {publishExtraSlot.facultyAbbr && <p><span className="font-semibold">Faculdade:</span> {publishExtraSlot.facultyAbbr}</p>}
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Observação (opcional)</label>
                                                <textarea
                                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                                                    rows={2}
                                                    placeholder="Ex.: Cobertura de falta, plantão de reposição…"
                                                    value={publishExtraNotes}
                                                    onChange={(e) => setPublishExtraNotes(e.target.value)}
                                                />
                                            </div>
                                            {publishExtraMessage && (
                                                <p className={`text-xs font-medium ${publishExtraMessage.type === "success" ? "text-emerald-600" : "text-red-600"}`}>
                                                    {publishExtraMessage.text}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                                            <button type="button" onClick={() => setPublishExtraSlot(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancelar</button>
                                            <button
                                                type="button"
                                                disabled={publishExtraLoading}
                                                onClick={() => void submitPublishExtra()}
                                                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"
                                            >
                                                {publishExtraLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Publicar Extra
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                }
                                                    setAllocFacultyId(internFacultyId);
                                                }
                                            }}
                                            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${allocInternId === user.id ? "bg-accent-50 text-accent-700 ring-1 ring-accent-300" : "bg-white text-slate-700 hover:bg-slate-100"}`}
                                        >
                                            <span className="min-w-0 flex-1 truncate">{user.name}</span>
                                            <span className="ml-3 flex items-center gap-1.5">
                                                {hasRole(user, "LEADER") && hasRole(user, "INTERN") && (
                                                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">L+I</span>
                                                )}
                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${getInternFacultyId(user) === allocation.facultyId ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                                    {getInternFacultyAbbr(user) ?? "Sem faculdade"}
                                                </span>
                                            </span>
                                        </button>
                                    ))
                                )}
                            </div>

                            {(allocationCandidates.blockedCount > 0 || allocationCandidates.busyCount > 0) && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                    {!isRetroactiveAdminAllocation && allocationCandidates.blockedCount > 0 && <p>{allocationCandidates.blockedCount} interno(s) ocultado(s) por conflito CRU/CRL ±12h.</p>}
                                    {allocationCandidates.busyCount > 0 && <p>{allocationCandidates.busyCount} interno(s) já ocupados neste mesmo dia e turno.</p>}
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
                            <button type="button" onClick={() => {
                                setAllocation(null);
                                setAllocFacultyId("");
                                setAllocCandidateFacultyFilter("ALL");
                            }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
                            <button type="button" disabled={allocLoading || !allocInternId || !assignmentFacultyId} onClick={createAssignment} className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50">
                                {allocLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Alocar na escala
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {focusedPeriod && focusedPeriodBase && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setFocusedPeriod(null)}>
                    <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
                            <div>
                                <p className="text-sm font-medium text-accent-600">Detalhes do turno</p>
                                <h3 className="text-xl font-semibold text-slate-900">{focusedPeriod.baseCode} - {focusedPeriod.baseName}</h3>
                                <p className="text-sm text-slate-500">{formatDayMonth(focusedPeriod.date)} · {formatPeriod(focusedPeriod.period)} · {focusedPeriodSlots.length} item(ns)</p>
                            </div>
                            <button type="button" onClick={() => setFocusedPeriod(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-4 w-4" /></button>
                        </div>

                        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-6 py-5">
                            {focusedPeriodSlots.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                                    Não há vagas ou plantões neste turno.
                                </div>
                            ) : focusedPeriodSlots.map((slot) => {
                                if (slot.kind === "assignment") {
                                    return (
                                        <AssignmentSlotCard
                                            key={slot.key}
                                            assignment={slot.assignment}
                                            period={focusedPeriod.period}
                                            onSelect={(assignmentId) => {
                                                setFocusedPeriod(null);
                                                setSelectedAssignmentId(assignmentId);
                                            }}
                                        />
                                    );
                                }

                                return (
                                    <VacancySlotCard
                                        key={slot.key}
                                        facultyAbbr={slot.facultyAbbr}
                                        allocation={slot.allocation}
                                        period={focusedPeriod.period}
                                        onOpen={(slotAllocation) => {
                                            setFocusedPeriod(null);
                                            void openAllocation(slotAllocation);
                                        }}
                                        facultyBadgeMode="faculty"
                                        showBaseCode
                                        isVirtual={facultyById.get(slot.allocation.facultyId ?? "")?.isVirtual}
                                    />
                                );
                            })}
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
                                <p className="mt-1 text-sm text-slate-500">{selectedAssignment.base_code} — {selectedAssignment.base_name} · {formatDayMonth(selectedAssignment.date)} · {formatPeriod(selectedAssignment.period, selectedAssignment.shift)}</p>
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
                                    {selectedAssignment.intern_observations && <p className="mt-2 text-xs text-slate-500">Interno: {selectedAssignment.intern_observations}</p>}
                                    {selectedAssignment.preceptor_observations && <p className="mt-2 text-xs text-slate-500">Preceptor: {selectedAssignment.preceptor_observations}</p>}
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

                                <AdminManualAttendanceActions assignmentId={selectedAssignment.id} status={selectedAssignment.status} onUpdated={loadAssignments} />

                                <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">
                                    A coordenação pode registrar presença, checkout ou falta retroativamente. Toda ação manual fica auditada.
                                </div>

                                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500">
                                    <p>Interno: <span className="font-medium text-slate-700">{selectedAssignment.intern_name}</span></p>
                                    <p className="mt-1">Faculdade: <span className="font-medium text-slate-700">{selectedAssignment.faculty_abbr}</span></p>
                                    <p className="mt-1">Base: <span className="font-medium text-slate-700">{selectedAssignment.base_code}</span></p>
                                    <p className="mt-1">Turno: <span className="font-medium text-slate-700">{formatPeriod(selectedAssignment.period, selectedAssignment.shift)}</span></p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}