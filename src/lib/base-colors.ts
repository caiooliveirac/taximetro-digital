/**
 * Visual mapping for SAMU base types → consistent color system.
 * Uses the CSS variables --color-base-usa/central defined in globals.css.
 */

/** Canonical view order — sorted by numeric suffix */
export const BASE_VIEW_ORDER = [
  "SM01", "CB02", "PR03", "PM04", "BR05", "CN10",
  "PP20", "IT30", "PM40", "CZ50", "BR60", "CC70",
] as const;

export function baseViewIndex(code: string): number {
  const idx = BASE_VIEW_ORDER.indexOf(code as typeof BASE_VIEW_ORDER[number]);
  return idx >= 0 ? idx : 999;
}

export type BaseType = "USA" | "CENTRAL" | "CRL";

const BASE_STYLES: Record<BaseType, {
  dot: string;      // colored dot / indicator
  bg: string;       // light background
  text: string;     // text color
  border: string;   // border color
  pill: string;     // combined pill style (bg + text + ring)
  label: string;
}> = {
  USA: {
    dot: "bg-red-500",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    pill: "bg-red-50 text-red-700 ring-1 ring-red-600/20",
    label: "USA",
  },
  CENTRAL: {
    dot: "bg-violet-500",
    bg: "bg-violet-50",
    text: "text-violet-700",
    border: "border-violet-200",
    pill: "bg-violet-50 text-violet-700 ring-1 ring-violet-600/20",
    label: "Central",
  },
  CRL: {
    dot: "bg-rose-500",
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
    pill: "bg-rose-50 text-rose-700 ring-1 ring-rose-600/20",
    label: "CRL",
  },
};

export function getBaseStyle(type: string | undefined | null) {
  return BASE_STYLES[(type as BaseType)] ?? BASE_STYLES.USA;
}

/** Period visual helpers */
export const PERIOD_STYLES = {
  DAY: {
    bg: "bg-amber-50/60",
    text: "text-amber-700",
    icon: "text-amber-500",
    label: "Diurno",
    emoji: "☀️",
  },
  NIGHT: {
    bg: "bg-indigo-50/60",
    text: "text-indigo-700",
    icon: "text-indigo-500",
    label: "Noturno",
    emoji: "🌙",
  },
} as const;

export function getPeriodStyle(period: string) {
  return PERIOD_STYLES[period as keyof typeof PERIOD_STYLES] ?? PERIOD_STYLES.DAY;
}

/** Faculty color system — EBMSP verde, UFBA laranja, UNIFACS amarelo, ZARNS azul, AFYA vermelho */
const FACULTY_STYLES: Record<string, {
  dot: string;
  bg: string;
  text: string;
  border: string;
  pill: string;
  label: string;
  glowColor: string;
}> = {
  EBMSP: {
    dot: "bg-emerald-500",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    pill: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20",
    label: "EBMSP",
    glowColor: "rgba(16,185,129,0.6)",
  },
  UFBA: {
    dot: "bg-orange-500",
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
    pill: "bg-orange-50 text-orange-700 ring-1 ring-orange-600/20",
    label: "UFBA",
    glowColor: "rgba(249,115,22,0.6)",
  },
  UNIFACS: {
    dot: "bg-yellow-500",
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    border: "border-yellow-200",
    pill: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-600/20",
    label: "UNIFACS",
    glowColor: "rgba(234,179,8,0.6)",
  },
  ZARNS: {
    dot: "bg-sky-500",
    bg: "bg-sky-50",
    text: "text-sky-700",
    border: "border-sky-200",
    pill: "bg-sky-50 text-sky-700 ring-1 ring-sky-600/20",
    label: "ZARNS",
    glowColor: "rgba(14,165,233,0.6)",
  },
  AFYA: {
    dot: "bg-rose-500",
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
    pill: "bg-rose-50 text-rose-700 ring-1 ring-rose-600/20",
    label: "AFYA",
    glowColor: "rgba(244,63,94,0.6)",
  },
  "PÓS": {
    dot: "bg-zinc-500",
    bg: "bg-zinc-100",
    text: "text-zinc-700",
    border: "border-zinc-300",
    pill: "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-500/30",
    label: "PÓS",
    glowColor: "rgba(113,113,122,0.6)",
  },
  RESI: {
    dot: "bg-stone-500",
    bg: "bg-stone-100",
    text: "text-stone-700",
    border: "border-stone-300",
    pill: "bg-stone-100 text-stone-700 ring-1 ring-stone-500/30",
    label: "RESI",
    glowColor: "rgba(120,113,108,0.6)",
  },
};

const FALLBACK_FACULTY = {
  dot: "bg-slate-400",
  bg: "bg-slate-50",
  text: "text-slate-600",
  border: "border-slate-200",
  pill: "bg-slate-50 text-slate-600 ring-1 ring-slate-400/20",
  label: "?",
  glowColor: "rgba(99,102,241,0.6)",
};

export function getFacultyStyle(abbr: string | undefined | null) {
  return FACULTY_STYLES[(abbr ?? "").toUpperCase()] ?? { ...FALLBACK_FACULTY, label: abbr ?? "?" };
}
