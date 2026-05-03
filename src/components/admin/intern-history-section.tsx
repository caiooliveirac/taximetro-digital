"use client";

import { useEffect, useState } from "react";
import { Calendar, CheckCircle2, XCircle, Clock, Target, Activity, FileText, AlertCircle } from "lucide-react";
import { operationalDateStr } from "@/lib/utils";
import { VelocimeterCard } from "@/components/admin/velocimeter-card";
import {
  RealizedByTypeBoxes,
  ShiftListByKind,
  WeekBreakdownByType,
  type Assignment as ShiftAssignment,
  type ComplianceWeekFields,
} from "@/components/admin/intern-shifts-blocks";

type Compliance = ComplianceWeekFields & {
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
};

type Assignment = ShiftAssignment;

type CaseRecord = {
  id: string;
  caseNumber: string;
  nickname: string;
  description: string | null;
  createdAt: string;
};

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
          <div className="mt-3">
            <WeekBreakdownByType compliance={compliance} />
          </div>
        </section>
      )}

      <section>
        <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Plantões realizados por tipo</h4>
        <RealizedByTypeBoxes assignments={pastAll} />
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
