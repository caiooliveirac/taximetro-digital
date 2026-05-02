"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ArrowRight, Calendar, CheckCircle2, XCircle, Clock, Target, Activity, FileText, AlertCircle } from "lucide-react";
import { getFacultyStyle } from "@/lib/base-colors";
import { operationalDateStr } from "@/lib/utils";

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
};

type Assignment = {
  id: string;
  baseCode: string;
  baseName: string;
  date: string;
  period: string;
  status: string;
};

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

const COMPLIANCE_BADGE: Record<Compliance["status"], { label: string; pill: string }> = {
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

export function InternQuickModal({
  internId,
  internName,
  facultyAbbr,
  onClose,
}: {
  internId: string;
  internName: string;
  facultyAbbr: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [caseRecords, setCaseRecords] = useState<CaseRecord[]>([]);

  useEffect(() => {
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

  const today = operationalDateStr();
  const past = assignments.filter((a) => a.date <= today).slice(-5).reverse();
  const upcoming = assignments.filter((a) => a.date > today).slice(0, 5);
  const recentCases = caseRecords.slice(0, 3);
  const fst = getFacultyStyle(facultyAbbr);

  function goToFullProfile() {
    router.push(`/admin/ver-interno?internId=${internId}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 animate-[fadeInUp_120ms_ease-out]"
      onClick={onClose}
    >
      <div
        className="relative max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-lg font-semibold text-slate-900">{internName}</h3>
              {facultyAbbr && (
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${fst.pill}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                  {facultyAbbr}
                </span>
              )}
              {compliance && (
                <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${COMPLIANCE_BADGE[compliance.status].pill}`}>
                  {COMPLIANCE_BADGE[compliance.status].label}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">Resumo rápido — clique em "Ver perfil completo" para gerir o interno</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[65vh] overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="space-y-3">
              <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ) : (
            <div className="space-y-5">
              {/* Compliance KPIs */}
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
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-slate-500">Esta semana</p>
                      <p className="mt-0.5 font-medium text-slate-800 tabular-nums">
                        {compliance.thisWeekCompleted}/{compliance.thisWeekScheduled} cumpridos
                      </p>
                    </div>
                    <div className={`rounded-lg px-3 py-2 ${compliance.belowWeeklyTarget ? "bg-amber-50" : "bg-slate-50"}`}>
                      <p className={compliance.belowWeeklyTarget ? "text-amber-700" : "text-slate-500"}>Semana passada</p>
                      <p className={`mt-0.5 font-medium tabular-nums ${compliance.belowWeeklyTarget ? "text-amber-900" : "text-slate-800"}`}>
                        {compliance.lastWeekCompleted}/{compliance.targetShiftsPerWeek} {compliance.belowWeeklyTarget && "· abaixo"}
                      </p>
                    </div>
                  </div>
                </section>
              )}

              {/* Próximos plantões */}
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <Clock className="h-3 w-3" strokeWidth={2} /> Próximos plantões
                </h4>
                {upcoming.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">Nenhum plantão agendado.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {upcoming.map((a) => (
                      <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <span className="font-medium text-slate-800">{a.baseCode}</span>
                          <span className="ml-2 text-xs text-slate-500">{PERIOD_LABEL[a.period] ?? a.period}</span>
                        </div>
                        <span className="text-xs tabular-nums text-slate-500">{formatDate(a.date)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Últimos plantões */}
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <Activity className="h-3 w-3" strokeWidth={2} /> Últimos plantões
                </h4>
                {past.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">Sem histórico.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {past.map((a) => (
                      <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="font-medium text-slate-800">{a.baseCode}</span>
                          <span className="text-xs text-slate-500">{PERIOD_LABEL[a.period] ?? a.period}</span>
                          <span className={`text-[11px] font-medium ${statusColor(a.status)}`}>
                            {STATUS_LABEL[a.status] ?? a.status}
                          </span>
                        </div>
                        <span className="text-xs tabular-nums text-slate-500">{formatDate(a.date)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Ocorrências clínicas */}
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

              {!compliance && !loading && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span>Sem dados de cumprimento ainda — interno pode estar fora de turma ativa.</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 bg-slate-50 px-6 py-3">
          <button
            onClick={goToFullProfile}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 active:scale-[0.99]"
          >
            Ver perfil completo
            <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
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
