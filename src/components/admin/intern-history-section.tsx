"use client";

import { useEffect, useState } from "react";
import { Calendar, CheckCircle2, XCircle, Clock, Target, Activity, FileText, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { operationalDateStr } from "@/lib/utils";
import { VelocimeterCard } from "@/components/admin/velocimeter-card";

type Compliance = {
  userId: string;
  name: string;
  facultyAbbr: string;
  targetShifts: number;
  totalCompleted: number;
  totalAbsent: number;
  totalScheduled: number;
  futureScheduled: number;
  totalPct: number | null;
  thisWeekCompleted: number;
  thisWeekScheduled: number;
  status: "ok" | "compensating" | "partial" | "deficit";
  belowWeeklyTarget: boolean;
  targetShiftsPerWeek: number;
  lastWeekCompleted: number;
  rotationStartDate: string | null;
  rotationEndDate: string | null;
  targetUSAPerWeek: number;
  targetCRUPerWeek: number;
  targetCRLPerWeek: number;
  thisWeekUSAPlanned?: number;
  thisWeekCRUPlanned?: number;
  thisWeekCRLPlanned?: number;
  lastWeekUSACompleted: number;
  lastWeekCRUCompleted: number;
  lastWeekCRLCompleted: number;
};

type BreakdownRow = { type: "USA" | "CRU" | "CRL"; completed: number; target: number; below: boolean };

function buildWeekBreakdown(c: Compliance, when: "thisWeek" | "lastWeek"): BreakdownRow[] {
  const out: BreakdownRow[] = [];
  const pickThis = when === "thisWeek";
  if (c.targetUSAPerWeek > 0) {
    const completed = pickThis ? (c.thisWeekUSAPlanned ?? 0) : c.lastWeekUSACompleted;
    out.push({ type: "USA", completed, target: c.targetUSAPerWeek, below: completed < c.targetUSAPerWeek });
  }
  if (c.targetCRUPerWeek > 0) {
    const completed = pickThis ? (c.thisWeekCRUPlanned ?? 0) : c.lastWeekCRUCompleted;
    out.push({ type: "CRU", completed, target: c.targetCRUPerWeek, below: completed < c.targetCRUPerWeek });
  }
  if (c.targetCRLPerWeek > 0) {
    const completed = pickThis ? (c.thisWeekCRLPlanned ?? 0) : c.lastWeekCRLCompleted;
    out.push({ type: "CRL", completed, target: c.targetCRLPerWeek, below: completed < c.targetCRLPerWeek });
  }
  return out;
}

type Assignment = {
  id: string;
  baseCode: string;
  baseName: string;
  baseType?: "USA" | "CENTRAL" | "CRL" | string;
  date: string;
  period: string;
  status: string;
};

type ShiftKind = "CRU" | "USA" | "CRL";

const KIND_STYLE: Record<ShiftKind, { tile: string; num: string; label: string; chip: string }> = {
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

function kindOf(a: Assignment): ShiftKind | null {
  if (a.baseType === "CENTRAL") return "CRU";
  if (a.baseType === "USA") return "USA";
  if (a.baseType === "CRL") return "CRL";
  return null;
}

function isRealized(status: string): boolean {
  return status === "CONFIRMED" || status === "CHECKED_IN" || status === "CHECKED_OUT";
}

type CaseRecord = {
  id: string;
  caseNumber: string;
  nickname: string;
  description: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Escalado",
  CONFIRMED: "Confirmado",
  CHECKED_IN: "Presente",
  CHECKED_OUT: "Finalizado",
  ABSENT: "Falta",
  CANCELLED: "Cancelado",
};

const PERIOD_LABEL: Record<string, string> = { DAY: "Diurno", NIGHT: "Noturno" };

export const COMPLIANCE_BADGE: Record<Compliance["status"], { label: string; pill: string }> = {
  ok: { label: "No ritmo", pill: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  compensating: { label: "Compensando", pill: "bg-sky-50 text-sky-700 ring-1 ring-sky-200" },
  partial: { label: "Parcial", pill: "bg-amber-50 text-amber-700 ring-1 ring-amber-200" },
  deficit: { label: "Em déficit", pill: "bg-red-50 text-red-700 ring-1 ring-red-200" },
};

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });
}

function statusColor(status: string): string {
  if (status === "ABSENT") return "text-red-600";
  if (status === "CHECKED_IN" || status === "CHECKED_OUT") return "text-emerald-600";
  return "text-slate-500";
}

export type InternHistoryData = {
  compliance: Compliance | null;
  assignments: Assignment[];
};

export function useInternHistory(internId: string) {
  const [loading, setLoading] = useState(true);
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [caseRecords, setCaseRecords] = useState<CaseRecord[]>([]);

  useEffect(() => {
    if (!internId) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    Promise.all([
      fetch(`/taximetro/api/compliance?internId=${internId}`, { signal: ac.signal }).then((r) => r.json()),
      fetch(`/taximetro/api/assignments?internId=${internId}`, { signal: ac.signal }).then((r) => r.json()),
      fetch(`/taximetro/api/case-records?internId=${internId}`, { signal: ac.signal }).then((r) => r.json()),
    ])
      .then(([cJson, aJson, crJson]) => {
        if (cJson?.success && cJson.data?.[0]) setCompliance(cJson.data[0]);
        if (aJson?.success) {
          setAssignments(
            (aJson.data as Assignment[])
              .filter((a) => a.status !== "CANCELLED")
              .sort((a, b) => a.date.localeCompare(b.date))
          );
        }
        if (crJson?.success) setCaseRecords(crJson.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [internId]);

  return { loading, compliance, assignments, caseRecords };
}

type SectionProps =
  | { internId: string; data?: undefined }
  | { internId?: undefined; data: ReturnType<typeof useInternHistory> };

export function InternHistorySection(props: SectionProps) {
  const fetched = useInternHistory(props.internId ?? "");
  const { loading, compliance, assignments, caseRecords } = props.data ?? fetched;

  const today = operationalDateStr();
  const pastAll = assignments.filter((a) => a.date <= today);
  const upcomingAll = assignments.filter((a) => a.date > today);
  const pastReversed = [...pastAll].reverse();
  const recentCases = caseRecords.slice(0, 3);

  const realized = pastAll.filter((a) => isRealized(a.status));
  const realizedCounts: Record<ShiftKind, number> = {
    CRU: realized.filter((a) => kindOf(a) === "CRU").length,
    USA: realized.filter((a) => kindOf(a) === "USA").length,
    CRL: realized.filter((a) => kindOf(a) === "CRL").length,
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {compliance && compliance.targetShifts > 0 && (
        <VelocimeterCard
          variant="card"
          data={{
            completed: compliance.totalCompleted,
            target: compliance.targetShifts,
            rotationStartDate: compliance.rotationStartDate,
            rotationEndDate: compliance.rotationEndDate,
            weeklyTarget: compliance.targetShiftsPerWeek,
          }}
        />
      )}

      {compliance && (
        <section>
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Cumprimento</h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <KpiCell
              Icon={CheckCircle2}
              label="Realizados"
              value={`${compliance.totalCompleted}`}
              sub={`/ ${compliance.targetShifts}`}
              tone="success"
            />
            <KpiCell
              Icon={XCircle}
              label="Faltas"
              value={`${compliance.totalAbsent}`}
              tone={compliance.totalAbsent > 0 ? "danger" : "default"}
            />
            <KpiCell
              Icon={Calendar}
              label="Agendados"
              value={`${compliance.futureScheduled}`}
              tone="default"
            />
            <KpiCell
              Icon={Target}
              label="% concluído"
              value={compliance.totalPct !== null ? `${compliance.totalPct}%` : "—"}
              tone={compliance.totalPct !== null && compliance.totalPct >= 80 ? "success" : compliance.totalPct !== null && compliance.totalPct >= 50 ? "default" : "warning"}
            />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <WeekBreakdownCard label="Esta semana" rows={buildWeekBreakdown(compliance, "thisWeek")} />
            <WeekBreakdownCard label="Semana passada" rows={buildWeekBreakdown(compliance, "lastWeek")} />
          </div>
        </section>
      )}

      <section>
        <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Plantões realizados por tipo</h4>
        <div className="grid grid-cols-3 gap-2">
          {(["CRU", "USA", "CRL"] as ShiftKind[]).map((kind) => {
            const s = KIND_STYLE[kind];
            return (
              <div key={kind} className={`rounded-xl border p-2.5 text-center ${s.tile}`}>
                <p className={`text-2xl font-bold tabular-nums leading-none ${s.num}`}>{realizedCounts[kind]}</p>
                <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wider ${s.label}`}>{kind}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <Clock className="h-3 w-3" strokeWidth={2} /> Próximos plantões
        </h4>
        <ShiftListByKind items={upcomingAll} emptyMessage="Nenhum plantão agendado." showStatus={false} initialLimit={10} />
      </section>

      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <Activity className="h-3 w-3" strokeWidth={2} /> Últimos plantões
        </h4>
        <ShiftListByKind items={pastReversed} emptyMessage="Sem histórico." showStatus initialLimit={10} />
      </section>

      {recentCases.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <FileText className="h-3 w-3" strokeWidth={2} /> Ocorrências recentes
          </h4>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {recentCases.map((c) => (
              <li key={c.id} className="px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-800">#{c.caseNumber} {c.nickname}</span>
                  <span className="text-[11px] tabular-nums text-slate-400">
                    {formatDate(c.createdAt.slice(0, 10))}
                  </span>
                </div>
                {c.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{c.description}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!compliance && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>Sem dados de cumprimento ainda — interno pode estar fora de turma ativa.</span>
        </div>
      )}
    </div>
  );
}

function ShiftListByKind({
  items,
  emptyMessage,
  showStatus,
  initialLimit,
}: {
  items: Assignment[];
  emptyMessage: string;
  showStatus: boolean;
  initialLimit: number;
}) {
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
                  s ? `${s.chip}` : "bg-slate-100 text-slate-600 ring-slate-200"
                }`}
              >
                {isKnown ? kind : "Outros"}
              </span>
              <span className="text-[10px] tabular-nums text-slate-500">{list.length}</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {list.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="font-medium text-slate-800">{a.baseCode}</span>
                    <span className="text-xs text-slate-500">{PERIOD_LABEL[a.period] ?? a.period}</span>
                    {showStatus && (
                      <span className={`text-[11px] font-medium ${statusColor(a.status)}`}>
                        {STATUS_LABEL[a.status] ?? a.status}
                      </span>
                    )}
                  </div>
                  <span className="text-xs tabular-nums text-slate-500">{formatDate(a.date)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function WeekBreakdownCard({ label, rows }: { label: string; rows: BreakdownRow[] }) {
  const anyBelow = rows.some((r) => r.below);
  if (rows.length === 0) {
    return (
      <div className="rounded-lg bg-slate-50 px-3 py-2">
        <p className="text-slate-500">{label}</p>
        <p className="mt-0.5 text-xs text-slate-400 italic">Sem meta semanal configurada</p>
      </div>
    );
  }
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

function KpiCell({
  Icon,
  label,
  value,
  sub,
  tone,
}: {
  Icon: typeof CheckCircle2;
  label: string;
  value: string;
  sub?: string;
  tone: "default" | "success" | "warning" | "danger";
}) {
  const TONE = {
    default: "bg-slate-50 text-slate-900",
    success: "bg-emerald-50 text-emerald-900",
    warning: "bg-amber-50 text-amber-900",
    danger: "bg-red-50 text-red-900",
  } as const;
  const ICON_TONE = {
    default: "text-slate-500",
    success: "text-emerald-600",
    warning: "text-amber-600",
    danger: "text-red-600",
  } as const;
  return (
    <div className={`rounded-lg px-3 py-2 ${TONE[tone]}`}>
      <Icon className={`h-3.5 w-3.5 ${ICON_TONE[tone]}`} strokeWidth={1.75} />
      <p className="mt-1 text-[10px] font-medium uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums leading-none">
        {value}
        {sub && <span className="text-xs font-normal opacity-60"> {sub}</span>}
      </p>
    </div>
  );
}
