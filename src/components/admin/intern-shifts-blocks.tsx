"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Sun, Moon, Repeat } from "lucide-react";
import { useSession } from "next-auth/react";
import { StatusBadge } from "@/components/status-badge";
import { getPeriodStyle } from "@/lib/base-colors";
import { sessionHasRole } from "@/lib/roles";

/* ──────────────────────────────────────────────────────────────────
 * Tipos compartilhados
 * ────────────────────────────────────────────────────────────────── */

export type ShiftKind = "CRU" | "USA" | "CRL";

export type Assignment = {
  id: string;
  baseCode: string;
  baseName?: string;
  baseType?: string | null;
  date: string;
  period: string;
  status: string;
};

/** Subconjunto da linha de compliance que esses blocos consomem. */
export type ComplianceWeekFields = {
  targetUSAPerWeek?: number;
  targetCRUPerWeek?: number;
  targetCRLPerWeek?: number;
  thisWeekUSAPlanned?: number;
  thisWeekCRUPlanned?: number;
  thisWeekCRLPlanned?: number;
  lastWeekUSACompleted?: number;
  lastWeekCRUCompleted?: number;
  lastWeekCRLCompleted?: number;
};

export const KIND_STYLE: Record<ShiftKind, { tile: string; num: string; label: string; chip: string }> = {
  CRU: {
    tile: "border-violet-200 bg-violet-50",
    num: "text-violet-700",
    label: "text-violet-600",
    chip: "bg-violet-100 text-violet-700 ring-violet-200",
  },
  USA: {
    tile: "border-red-200 bg-red-50",
    num: "text-red-700",
    label: "text-red-600",
    chip: "bg-red-100 text-red-700 ring-red-200",
  },
  CRL: {
    tile: "border-rose-200 bg-rose-50",
    num: "text-rose-700",
    label: "text-rose-600",
    chip: "bg-rose-100 text-rose-700 ring-rose-200",
  },
};

const REALIZED_STATUSES = new Set(["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]);

export function isRealized(status: string): boolean {
  return REALIZED_STATUSES.has(status);
}

export function kindOf(a: Pick<Assignment, "baseType">): ShiftKind | null {
  if (a.baseType === "CENTRAL") return "CRU";
  if (a.baseType === "USA") return "USA";
  if (a.baseType === "CRL") return "CRL";
  return null;
}

/* ──────────────────────────────────────────────────────────────────
 * 1. Caixinhas CRU/USA/CRL (totais realizados)
 * ────────────────────────────────────────────────────────────────── */

type RealizedBoxesProps = {
  assignments: Assignment[];
  size?: "sm" | "md";
};

export function RealizedByTypeBoxes({ assignments, size = "md" }: RealizedBoxesProps) {
  const realized = assignments.filter((a) => isRealized(a.status));
  const counts: Record<ShiftKind, number> = {
    CRU: realized.filter((a) => kindOf(a) === "CRU").length,
    USA: realized.filter((a) => kindOf(a) === "USA").length,
    CRL: realized.filter((a) => kindOf(a) === "CRL").length,
  };
  const numClass = size === "sm" ? "text-lg" : "text-2xl";
  const padClass = size === "sm" ? "p-2.5" : "p-3";
  return (
    <div className="grid grid-cols-3 gap-2">
      {(["CRU", "USA", "CRL"] as ShiftKind[]).map((kind) => {
        const s = KIND_STYLE[kind];
        return (
          <div key={kind} className={`rounded-xl border text-center ${padClass} ${s.tile}`}>
            <p className={`${numClass} font-bold tabular-nums leading-none ${s.num}`}>{counts[kind]}</p>
            <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wider ${s.label}`}>{kind}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * 2. Breakdown semanal por tipo
 *    Mostra "Esta semana" e "Semana passada" lado a lado, com
 *    CRU/USA/CRL completed/target. Vermelho quando abaixo da meta.
 * ────────────────────────────────────────────────────────────────── */

type BreakdownRow = { type: ShiftKind; completed: number; target: number; below: boolean };

function buildWeekBreakdown(c: ComplianceWeekFields, when: "thisWeek" | "lastWeek"): BreakdownRow[] {
  const out: BreakdownRow[] = [];
  const pickThis = when === "thisWeek";
  const tUSA = c.targetUSAPerWeek ?? 0;
  const tCRU = c.targetCRUPerWeek ?? 0;
  const tCRL = c.targetCRLPerWeek ?? 0;
  if (tCRU > 0) {
    const completed = pickThis ? (c.thisWeekCRUPlanned ?? 0) : (c.lastWeekCRUCompleted ?? 0);
    out.push({ type: "CRU", completed, target: tCRU, below: completed < tCRU });
  }
  if (tUSA > 0) {
    const completed = pickThis ? (c.thisWeekUSAPlanned ?? 0) : (c.lastWeekUSACompleted ?? 0);
    out.push({ type: "USA", completed, target: tUSA, below: completed < tUSA });
  }
  if (tCRL > 0) {
    const completed = pickThis ? (c.thisWeekCRLPlanned ?? 0) : (c.lastWeekCRLCompleted ?? 0);
    out.push({ type: "CRL", completed, target: tCRL, below: completed < tCRL });
  }
  return out;
}

export function WeekBreakdownByType({ compliance }: { compliance: ComplianceWeekFields | null | undefined }) {
  if (!compliance) return null;
  const thisWeek = buildWeekBreakdown(compliance, "thisWeek");
  const lastWeek = buildWeekBreakdown(compliance, "lastWeek");
  if (thisWeek.length === 0 && lastWeek.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
      <WeekBreakdownCell label="Esta semana" rows={thisWeek} />
      <WeekBreakdownCell label="Semana passada" rows={lastWeek} />
    </div>
  );
}

function WeekBreakdownCell({ label, rows }: { label: string; rows: BreakdownRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg bg-slate-50 px-3 py-2">
        <p className="text-slate-500">{label}</p>
        <p className="mt-0.5 text-xs text-slate-400 italic">Sem meta semanal configurada</p>
      </div>
    );
  }
  const anyBelow = rows.some((r) => r.below);
  return (
    <div className={`rounded-lg px-3 py-2 ${anyBelow ? "bg-amber-50" : "bg-slate-50"}`}>
      <p className={anyBelow ? "text-amber-700" : "text-slate-500"}>{label}</p>
      <p className="mt-0.5 inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium tabular-nums">
        {rows.map((r, idx) => (
          <span key={r.type} className={r.below ? "text-red-700 font-semibold" : "text-slate-800"}>
            {idx > 0 && <span className="mx-0.5 text-slate-300">·</span>}
            {r.type} {r.completed}/{r.target}
          </span>
        ))}
      </p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * 3. Lista de plantões agrupada por tipo (CRU/USA/CRL/Outros)
 *    com toggle "ver todos". Suporta:
 *    - renderInlineExtra: bloco sempre visível abaixo da linha (ex. justificar falta no líder)
 *    - renderDetail + expandedId/onToggleExpand: painel sob demanda (ex. detalhes TOTP no admin)
 * ────────────────────────────────────────────────────────────────── */

const PERIOD_LABEL: Record<string, string> = { DAY: "Diurno", NIGHT: "Noturno" };

type ShiftListProps = {
  items: Assignment[];
  emptyMessage: string;
  showStatus: boolean;
  initialLimit: number;
  expandedId?: string | null;
  onToggleExpand?: (id: string | null) => void;
  renderDetail?: (a: Assignment) => ReactNode;
  renderInlineExtra?: (a: Assignment) => ReactNode;
};

export function ShiftListByKind({
  items,
  emptyMessage,
  showStatus,
  initialLimit,
  expandedId,
  onToggleExpand,
  renderDetail,
  renderInlineExtra,
}: ShiftListProps) {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) {
    return <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">{emptyMessage}</p>;
  }
  const total = items.length;
  const visible = showAll ? items : items.slice(0, initialLimit);
  const hasMore = total > initialLimit;

  const groups: { kind: ShiftKind | "OUTRO"; items: Assignment[] }[] = [];
  for (const kind of ["CRU", "USA", "CRL"] as ShiftKind[]) {
    const subset = visible.filter((a) => kindOf(a) === kind);
    if (subset.length > 0) groups.push({ kind, items: subset });
  }
  const others = visible.filter((a) => kindOf(a) === null);
  if (others.length > 0) groups.push({ kind: "OUTRO", items: others });

  return (
    <div className="space-y-2">
      {hasMore && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            {showAll ? (
              <>
                <ChevronUp className="h-3 w-3" /> Mostrar só {initialLimit}
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> Ver todos ({total})
              </>
            )}
          </button>
        </div>
      )}
      {groups.map(({ kind, items: list }) => {
        const isKnown = kind !== "OUTRO";
        const s = isKnown ? KIND_STYLE[kind] : null;
        return (
          <div key={kind} className="overflow-hidden rounded-lg border border-slate-200">
            <div className="flex items-center justify-between bg-slate-50/80 px-3 py-1.5">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
                  s ? s.chip : "bg-slate-100 text-slate-600 ring-slate-200"
                }`}
              >
                {isKnown ? kind : "Outros"}
              </span>
              <span className="text-[10px] tabular-nums text-slate-500">{list.length}</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {list.map((a) => {
                const ps = getPeriodStyle(a.period);
                const isExpanded = expandedId === a.id;
                const canExpand = !!renderDetail && !!onToggleExpand;
                const inlineExtra = renderInlineExtra?.(a);
                return (
                  <li key={a.id} className="bg-white">
                    <button
                      type="button"
                      onClick={canExpand ? () => onToggleExpand!(isExpanded ? null : a.id) : undefined}
                      disabled={!canExpand}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                        canExpand ? "cursor-pointer hover:bg-slate-50" : "cursor-default"
                      }`}
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="font-medium text-slate-800">{a.baseCode}</span>
                        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${ps.text}`}>
                          {a.period === "DAY" ? <Sun className="h-3 w-3" strokeWidth={1.5} /> : <Moon className="h-3 w-3" strokeWidth={1.5} />}
                          {ps.label}
                        </span>
                        {showStatus && <StatusBadge status={a.status} />}
                      </div>
                      <span className="flex items-center gap-2 text-xs tabular-nums text-slate-500">
                        {new Date(a.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                        {canExpand && (
                          <ChevronDown
                            className={`h-3.5 w-3.5 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            strokeWidth={1.5}
                          />
                        )}
                      </span>
                    </button>
                    {inlineExtra && (
                      <div className="border-t border-slate-100 px-3 py-2 bg-slate-50/40">{inlineExtra}</div>
                    )}
                    {canExpand && isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2">{renderDetail!(a)}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * 4. Histórico de trocas (com toggle "ver todos")
 * ────────────────────────────────────────────────────────────────── */

type SwapSlot = {
  baseCode: string;
  baseName?: string;
  date: string;
  period: string;
};

export type SwapHistoryEntry = {
  id: string;
  completedAt: string;
  requester: { id: string; name: string; gave: SwapSlot | null; received: SwapSlot | null };
  target: { id: string | null; name: string | null; gave: SwapSlot | null; received: SwapSlot | null };
};

export function SwapHistoryList({
  swaps,
  currentInternId,
  initialLimit = 5,
  density = "comfortable",
}: {
  swaps: SwapHistoryEntry[];
  currentInternId: string;
  initialLimit?: number;
  density?: "comfortable" | "compact";
}) {
  const [showAll, setShowAll] = useState(false);
  if (swaps.length === 0) return null;
  const total = swaps.length;
  const visible = showAll ? swaps : swaps.slice(0, initialLimit);
  const hasMore = total > initialLimit;
  const isCompact = density === "compact";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Repeat className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />
          <h3 className={`${isCompact ? "text-xs uppercase tracking-wider" : "text-sm"} font-semibold text-slate-500`}>
            Trocas ({total})
          </h3>
        </div>
        {hasMore && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            {showAll ? (
              <>
                <ChevronUp className="h-3 w-3" /> Mostrar só {initialLimit}
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> Ver todas ({total})
              </>
            )}
          </button>
        )}
      </div>
      <div className={isCompact ? "space-y-1.5" : "space-y-2"}>
        {visible.map((swap) => {
          const isRequester = swap.requester.id === currentInternId;
          const self = isRequester ? swap.requester : swap.target;
          const peer = isRequester ? swap.target : swap.requester;
          return (
            <div
              key={swap.id}
              className={`rounded-lg border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${
                isCompact ? "px-3 py-2" : "p-3"
              }`}
            >
              <div className={`flex items-center justify-between ${isCompact ? "mb-1" : "mb-2"}`}>
                <span className="text-[11px] text-slate-500">
                  {new Date(swap.completedAt).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "2-digit",
                  })}
                </span>
                <span className="text-[11px] text-slate-400">com {peer.name ?? "?"}</span>
              </div>
              <div className={`grid grid-cols-2 ${isCompact ? "gap-2" : "gap-3"}`}>
                <SwapSlotCell tone="gave" slot={self.gave} compact={isCompact} />
                <SwapSlotCell tone="received" slot={self.received} compact={isCompact} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SwapSlotCell({ tone, slot, compact }: { tone: "gave" | "received"; slot: SwapSlot | null; compact: boolean }) {
  const palette =
    tone === "gave"
      ? { bg: "bg-red-50", border: "border-red-100", label: "text-red-600" }
      : { bg: "bg-emerald-50", border: "border-emerald-100", label: "text-emerald-600" };
  const labelText = tone === "gave" ? "Deu" : "Recebeu";
  return (
    <div className={`rounded ${palette.bg} ${compact ? "px-2 py-1" : `border ${palette.border} p-2`}`}>
      <p className={`text-[10px] font-medium ${palette.label} ${compact ? "" : "mb-1"}`}>{labelText}</p>
      {slot ? (
        <div className={compact ? "text-xs" : "text-sm"}>
          <span className="font-semibold text-slate-900">{slot.baseCode}</span>
          <span className="ml-1 text-slate-500">
            {new Date(slot.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
          </span>
          <span className={`ml-1 text-[11px] ${slot.period === "DAY" ? "text-amber-600" : "text-indigo-600"}`}>
            {slot.period === "DAY" ? "☀ D" : "🌙 N"}
          </span>
        </div>
      ) : (
        <span className="text-xs text-slate-400">—</span>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * 5. Painel de detalhes de um plantão (TOTP, checkout, ocorrências)
 *    Reutilizado nos dois ver-interno (admin + leader).
 * ────────────────────────────────────────────────────────────────── */

export type AssignmentDetail = Assignment & {
  checkinAt?: string | null;
  totpValidatedAt?: string | null;
  validatedBy?: string | null;
  validatedByName?: string | null;
  checkoutAt?: string | null;
  checkoutConfirmedBy?: string | null;
  checkoutConfirmedByName?: string | null;
  checkoutNotes?: string | null;
  internObservations?: string | null;
  preceptorObservations?: string | null;
};

export type CaseRecordSummary = {
  id: string;
  caseNumber: string;
  nickname: string;
  description: string | null;
};

function stripNpsFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const cleaned = notes
    .split("|")
    .map((seg) => seg.trim())
    .filter((seg) => seg && !seg.startsWith("NPS"))
    .join(" | ");
  return cleaned || null;
}

export function AssignmentDetailPanel({
  assignment: a,
  caseRecords,
  userNameById = {},
}: {
  assignment: AssignmentDetail;
  caseRecords: CaseRecordSummary[];
  userNameById?: Record<string, string>;
}) {
  const { data: session } = useSession();
  const canSeeEvaluation = sessionHasRole(session, "COORDINATOR");
  const visibleCheckoutNotes = canSeeEvaluation ? a.checkoutNotes : stripNpsFromNotes(a.checkoutNotes);
  return (
    <div className="space-y-1 text-xs text-slate-700">
      <p>
        <span className="font-semibold">Check-in:</span>{" "}
        {a.checkinAt ? new Date(a.checkinAt).toLocaleString("pt-BR") : "—"}
      </p>
      <p>
        <span className="font-semibold">Validação check-in:</span>{" "}
        {a.totpValidatedAt ? new Date(a.totpValidatedAt).toLocaleString("pt-BR") : "—"}
      </p>
      <p>
        <span className="font-semibold">Validado por:</span>{" "}
        {a.validatedBy
          ? userNameById[a.validatedBy] ?? a.validatedBy
          : a.validatedByName
            ? a.validatedByName
            : a.totpValidatedAt
              ? "Telegram"
              : "—"}
      </p>
      <p>
        <span className="font-semibold">Checkout:</span>{" "}
        {a.checkoutAt ? new Date(a.checkoutAt).toLocaleString("pt-BR") : "—"}
      </p>
      <p>
        <span className="font-semibold">Checkout confirmado por:</span>{" "}
        {a.checkoutConfirmedBy
          ? userNameById[a.checkoutConfirmedBy] ?? a.checkoutConfirmedBy
          : a.checkoutConfirmedByName
            ? a.checkoutConfirmedByName
            : a.checkoutAt
              ? "Telegram"
              : "—"}
      </p>
      <p>
        <span className="font-semibold">Observação do interno:</span> {a.internObservations || "—"}
      </p>
      {canSeeEvaluation && (
        <p>
          <span className="font-semibold">Observação do preceptor:</span> {a.preceptorObservations || "—"}
        </p>
      )}
      <p>
        <span className="font-semibold">Notas de checkout:</span> {visibleCheckoutNotes || "—"}
      </p>
      <div>
        <p className="font-semibold">Ocorrências clínicas:</p>
        {caseRecords.length > 0 ? (
          <ul className="mt-1 space-y-1">
            {caseRecords.map((record) => (
              <li key={record.id} className="rounded border border-slate-200 bg-white px-2 py-1">
                <span className="font-medium">
                  #{record.caseNumber} · {record.nickname}
                </span>
                {record.description ? <span className="text-slate-600"> — {record.description}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>—</p>
        )}
      </div>
    </div>
  );
}
