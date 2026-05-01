"use client";

import { useMemo, useState } from "react";

import type {
  ReportAssignmentCard,
  ReportDocument,
  ReportInternDocument,
  ReportTypeSection,
} from "@/lib/admin-report-builder";
import {
  checkinMethodLabel,
  checkinStatusLabel,
  formatBrazilDateTime,
  formatBrazilLongDate,
  formatBrazilTime,
  formatValidatorName,
} from "@/lib/utils";

function formatTimeOrDash(dateStr: string | null) {
  if (!dateStr) return "—";
  return formatBrazilTime(dateStr);
}

function periodLabel(period: string) {
  return period === "DAY" ? "☀️ Dia" : "🌙 Noite";
}

function periodDetailedLabel(period: string, shift: string | null | undefined) {
  if (period === "NIGHT") return "Noite";
  if (shift === "MORNING") return "Manhã";
  if (shift === "AFTERNOON") return "Tarde";
  return "Dia";
}

function assignmentStatusBadge(assignment: ReportAssignmentCard, group: "done" | "scheduled" | "absent") {
  if (group === "done") {
    return {
      label: assignment.status === "CHECKED_IN" ? "🔵 Em andamento" : "✅ Finalizado",
      className: "bg-emerald-100 text-emerald-800",
    };
  }
  if (group === "absent") {
    return {
      label: "⚠️ Ausência",
      className: "bg-rose-100 text-rose-800",
    };
  }
  return {
    label: assignment.status === "CONFIRMED" ? "✅ Confirmado" : "📅 Agendado",
    className: "bg-slate-100 text-slate-700",
  };
}

function AssignmentCard({
  assignment,
  group,
  compactCompleted,
}: {
  assignment: ReportAssignmentCard;
  group: "done" | "scheduled" | "absent";
  compactCompleted: boolean;
}) {
  const badge = assignmentStatusBadge(assignment, group);
  if (compactCompleted && group === "done") {
    return (
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-slate-700">
        <span className="font-medium text-slate-900">{formatBrazilLongDate(assignment.date)}</span>
        <span className="rounded bg-white px-2 py-0.5 text-xs text-slate-600">{assignment.baseCode}</span>
        <span className="rounded bg-white px-2 py-0.5 text-xs text-slate-600">{periodLabel(assignment.period)}</span>
        <span className="text-xs text-slate-500">{formatTimeOrDash(assignment.checkinAt)} → {formatTimeOrDash(assignment.checkoutAt)}</span>
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900">{formatBrazilLongDate(assignment.date)}</span>
        <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{periodLabel(assignment.period)}</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{assignment.baseCode}</span>
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
        <span>{assignment.baseName}</span>
        {assignment.shift ? <span>{assignment.shift === "MORNING" ? "Manhã" : "Tarde"}</span> : null}
        {assignment.checkinAt ? <span>Check-in: {formatTimeOrDash(assignment.checkinAt)}</span> : null}
        {assignment.checkoutAt ? <span>Check-out: {formatTimeOrDash(assignment.checkoutAt)}</span> : null}
      </div>
      {group === "absent" && assignment.isJustified ? (
        <div className="mt-2 rounded border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ✓ Justificada{assignment.absenceJustification ? ` — ${assignment.absenceJustification}` : ""}
        </div>
      ) : null}
      {group === "absent" && !assignment.isJustified ? (
        <div className="mt-2 rounded border-l-2 border-rose-400 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {assignment.status === "ABSENT" ? "⚠ Não justificada" : "⚠ Não compareceu"}
        </div>
      ) : null}
    </div>
  );
}

function SectionBlock({
  title,
  icon,
  count,
  toneClass,
  children,
}: {
  title: string;
  icon: string;
  count: number;
  toneClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-slate-200">
      <div className={`flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-sm font-semibold ${toneClass}`}>
        <span>{icon}</span>
        <span>{title}</span>
        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-700">{count}</span>
      </div>
      <div className="bg-white p-3">{children}</div>
    </div>
  );
}

function TypeSection({
  section,
  compactCompleted,
  hideEmptySections,
}: {
  section: ReportTypeSection;
  compactCompleted: boolean;
  hideEmptySections: boolean;
}) {
  if (hideEmptySections && section.done.length === 0 && section.scheduled.length === 0) return null;

  return (
    <section className="mb-5">
      <div className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: section.bgColor, borderLeft: `4px solid ${section.accentColor}` }}>
        <span className="text-lg">{section.icon}</span>
        <span className="font-semibold" style={{ color: section.accentColor }}>{section.label}</span>
        <div className="ml-auto flex gap-2 text-xs font-semibold">
          <span className="rounded px-2 py-0.5" style={{ background: "#dcfce7", color: "#166534" }}>✅ {section.done.length}</span>
          <span className="rounded px-2 py-0.5" style={{ background: "#f1f5f9", color: "#475569" }}>📅 {section.scheduled.length}</span>
        </div>
      </div>
      {(!hideEmptySections || section.done.length > 0) && section.done.length > 0 ? (
        <SectionBlock title="Cumpridos" icon="✅" count={section.done.length} toneClass="bg-emerald-50 text-emerald-800">
          {section.done.map((assignment) => (
            <AssignmentCard
              key={assignment.assignmentId}
              assignment={assignment}
              group="done"
              compactCompleted={compactCompleted}
            />
          ))}
        </SectionBlock>
      ) : null}
      {(!hideEmptySections || section.scheduled.length > 0) && section.scheduled.length > 0 ? (
        <SectionBlock title="Agendados" icon="📅" count={section.scheduled.length} toneClass="bg-slate-100 text-slate-700">
          {section.scheduled.map((assignment) => (
            <AssignmentCard
              key={assignment.assignmentId}
              assignment={assignment}
              group="scheduled"
              compactCompleted={false}
            />
          ))}
        </SectionBlock>
      ) : null}
    </section>
  );
}

function ProgressBlock({ intern }: { intern: ReportInternDocument }) {
  const hoursPercent = Math.min(100, intern.progress.percentHours ?? 0);
  const shiftsPercent = Math.min(100, intern.progress.percentShifts ?? 0);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-slate-900">Progresso vs meta</div>
      <div className="space-y-3 text-sm">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
            <span>Horas</span>
            <span>{intern.progress.completedHours} / {intern.progress.targetHours}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-accent-500" style={{ width: `${hoursPercent}%` }} />
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
            <span>Plantões</span>
            <span>{intern.progress.completedShifts} / {intern.progress.targetShifts}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-sky-500" style={{ width: `${shiftsPercent}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

type DetailedAssignment = {
  id: string;
  intern_name: string;
  faculty_abbr: string;
  base_code: string;
  base_name: string;
  date: string;
  period: string;
  shift: string | null;
  status: string;
  notes: string | null;
  checkin_status: string | null;
  checkin_method: string | null;
  checkin_at: string | null;
  validated_by_name: string | null;
  checkout_at: string | null;
  checkout_confirmed_by_name: string | null;
  geo_valid: boolean | null;
  intern_observations: string | null;
  preceptor_observations: string | null;
  checkout_notes: string | null;
};

function AssignmentDetailModal({
  assignment,
  loading,
  error,
  onClose,
  selectedCellLabel,
  assignmentIds,
  selectedAssignmentId,
  onSelectAssignment,
}: {
  assignment: DetailedAssignment | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  selectedCellLabel: string;
  assignmentIds: string[];
  selectedAssignmentId: string | null;
  onSelectAssignment: (assignmentId: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">Detalhes do plantão</h3>
            <p className="mt-1 text-sm text-slate-500">{selectedCellLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">✕</button>
        </div>

        {assignmentIds.length > 1 ? (
          <div className="border-b border-slate-100 px-6 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Plantões no dia ({assignmentIds.length})</p>
            <div className="flex flex-wrap gap-2">
              {assignmentIds.map((assignmentId, index) => (
                <button
                  key={assignmentId}
                  type="button"
                  onClick={() => onSelectAssignment(assignmentId)}
                  className={selectedAssignmentId === assignmentId
                    ? "rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700"
                    : "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"}
                >
                  Plantão {index + 1}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-6 px-6 py-5 lg:grid-cols-[1.1fr,0.9fr]">
          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 lg:col-span-2">
              Carregando detalhes...
            </div>
          ) : null}

          {!loading && error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 lg:col-span-2">
              {error}
            </div>
          ) : null}

          {!loading && !error && assignment ? (
            <>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{assignment.status}</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                    {assignment.faculty_abbr}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Check-in</p>
                    {assignment.checkin_at ? (
                      <>
                        <p className="mt-1 text-sm font-medium text-slate-900">{formatBrazilDateTime(assignment.checkin_at)}</p>
                        <p className="mt-1 text-xs text-slate-500">Status: {checkinStatusLabel(assignment.checkin_status)}</p>
                        <p className="mt-1 text-xs text-slate-500">Validado por: {formatValidatorName(assignment.validated_by_name)}</p>
                        <p className="mt-1 text-xs text-slate-500">Método: {checkinMethodLabel(assignment.checkin_method)}</p>
                        {assignment.geo_valid !== null && (
                          <p className="mt-1 text-xs text-slate-500">Geo: {assignment.geo_valid ? "Dentro do raio" : "Fora do raio"}</p>
                        )}
                      </>
                    ) : (
                      <p className="mt-1 text-sm font-medium text-slate-500">Sem check-in</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Checkout</p>
                    {assignment.checkout_at ? (
                      <>
                        <p className="mt-1 text-sm font-medium text-slate-900">{formatBrazilDateTime(assignment.checkout_at)}</p>
                        <p className="mt-1 text-xs text-slate-500">Confirmado por: {formatValidatorName(assignment.checkout_confirmed_by_name)}</p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm font-medium text-slate-500">Sem checkout</p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Notas do plantão</p>
                  <p className="mt-2 text-sm text-slate-700">{assignment.notes || "Sem observações operacionais."}</p>
                  {assignment.intern_observations ? <p className="mt-2 text-xs text-slate-500">Interno: {assignment.intern_observations}</p> : null}
                  {assignment.preceptor_observations ? <p className="mt-2 text-xs text-slate-500">Preceptor: {assignment.preceptor_observations}</p> : null}
                  {assignment.checkout_notes ? <p className="mt-2 text-xs text-slate-500">Checkout: {assignment.checkout_notes}</p> : null}
                </div>
              </div>

              <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Resumo do slot</p>
                  <p className="text-xs text-slate-500">Mesma leitura operacional disponível na tela de escalas.</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500">
                  <p>Interno: <span className="font-medium text-slate-700">{assignment.intern_name}</span></p>
                  <p className="mt-1">Faculdade: <span className="font-medium text-slate-700">{assignment.faculty_abbr}</span></p>
                  <p className="mt-1">Base: <span className="font-medium text-slate-700">{assignment.base_code} — {assignment.base_name}</span></p>
                  <p className="mt-1">Data: <span className="font-medium text-slate-700">{formatBrazilLongDate(assignment.date)}</span></p>
                  <p className="mt-1">Turno: <span className="font-medium text-slate-700">{periodDetailedLabel(assignment.period, assignment.shift)}</span></p>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Heatmap({ document, assignmentDetailPath = "/taximetro/api/admin/assignments" }: { document: ReportDocument; assignmentDetailPath?: string }) {
  if (document.cover.heatmapDays.length === 0 || document.cover.heatmapRows.length === 0) return null;

  const assignmentsByInternDate = useMemo(() => {
    const map = new Map<string, ReportAssignmentCard[]>();
    for (const intern of document.interns) {
      const grouped = [
        ...intern.absences,
        ...intern.typeSections.flatMap((section) => [...section.done, ...section.scheduled]),
      ];
      for (const assignment of grouped) {
        const key = `${intern.internId}::${assignment.date}`;
        const existing = map.get(key) ?? [];
        if (!existing.some((item) => item.assignmentId === assignment.assignmentId)) {
          existing.push(assignment);
          map.set(key, existing);
        }
      }
    }
    return map;
  }, [document.interns]);

  const [selectedCell, setSelectedCell] = useState<{
    internName: string;
    dateLabel: string;
    assignmentIds: string[];
  } | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailedAssignment, setDetailedAssignment] = useState<DetailedAssignment | null>(null);

  async function loadAssignmentDetailById(assignmentId: string) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await fetch(`${assignmentDetailPath}/${assignmentId}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Não foi possível carregar os detalhes do plantão.");
      }
      setDetailedAssignment(payload.data as DetailedAssignment);
      setSelectedAssignmentId(assignmentId);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Falha ao carregar detalhes do plantão.");
      setDetailedAssignment(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function openCellDetails(internName: string, date: string, assignmentIds: string[]) {
    if (assignmentIds.length === 0) return;
    setSelectedCell({
      internName,
      dateLabel: formatBrazilLongDate(date),
      assignmentIds,
    });
    void loadAssignmentDetailById(assignmentIds[0]);
  }

  function closeModal() {
    setSelectedCell(null);
    setSelectedAssignmentId(null);
    setDetailedAssignment(null);
    setDetailError(null);
    setDetailLoading(false);
  }

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-900">Heatmap de presença</div>
          <div className="text-xs text-slate-500">
            {document.cover.heatmapRows.length} internos · {document.cover.heatmapDays.length} dias
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">Cumprido</span>
          <span className="rounded bg-slate-200 px-2 py-0.5 text-slate-700">Agendado</span>
          <span className="rounded bg-rose-100 px-2 py-0.5 text-rose-800">Ausência</span>
          <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-800">Clique para ver detalhes</span>
        </div>
        <div className="max-h-[72vh] overflow-auto rounded-lg border border-slate-200">
          <table className="w-max min-w-full border-separate border-spacing-0">
            <thead className="sticky top-0 z-20 bg-white">
              <tr>
                <th className="sticky left-0 z-30 w-60 border-b border-r border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-600">Interno</th>
                {document.cover.heatmapDays.map((day) => (
                  <th key={day.date} className="border-b border-slate-200 bg-white px-1 py-2 text-center text-[10px] font-medium text-slate-500">
                    <div className="w-5">{day.label}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {document.cover.heatmapRows.map((row) => (
                <tr key={row.internId} className="odd:bg-slate-50/40">
                  <td className="sticky left-0 z-10 border-r border-slate-200 bg-inherit px-3 py-2 align-middle">
                    <div className="truncate text-xs font-medium text-slate-800">{row.internName}</div>
                    <div className="truncate text-[10px] text-slate-500">{row.cohortLabel}</div>
                  </td>
                  {row.cells.map((cell, index) => {
                    const day = document.cover.heatmapDays[index];
                    const assignmentIds = (assignmentsByInternDate.get(`${row.internId}::${day.date}`) ?? []).map((item) => item.assignmentId);
                    const isClickable = assignmentIds.length > 0;
                    const isSelected = Boolean(selectedCell && selectedCell.internName === row.internName && selectedCell.dateLabel === formatBrazilLongDate(day.date));
                    return (
                      <td key={`${row.internId}-${index}`} className="px-0.5 py-0.5">
                        <button
                          type="button"
                          disabled={!isClickable}
                          onClick={() => openCellDetails(row.internName, day.date, assignmentIds)}
                          className={cell === "done"
                            ? `h-5 w-5 rounded bg-emerald-400 ${isClickable ? "cursor-pointer hover:brightness-90" : ""} ${isSelected ? "ring-2 ring-sky-500 ring-offset-1" : ""}`
                            : cell === "scheduled"
                              ? `h-5 w-5 rounded bg-slate-300 ${isClickable ? "cursor-pointer hover:brightness-90" : ""} ${isSelected ? "ring-2 ring-sky-500 ring-offset-1" : ""}`
                              : cell === "absent"
                                ? `h-5 w-5 rounded bg-rose-400 ${isClickable ? "cursor-pointer hover:brightness-90" : ""} ${isSelected ? "ring-2 ring-sky-500 ring-offset-1" : ""}`
                                : "h-5 w-5 rounded bg-slate-100"}
                          aria-label={isClickable ? `Ver detalhes de ${row.internName} em ${day.label}` : `Sem plantão para ${row.internName} em ${day.label}`}
                          title={isClickable ? `Ver detalhes de ${row.internName} em ${formatBrazilLongDate(day.date)}` : "Sem plantão"}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedCell ? (
        <AssignmentDetailModal
          assignment={detailedAssignment}
          loading={detailLoading}
          error={detailError}
          onClose={closeModal}
          selectedCellLabel={`${selectedCell.internName} · ${selectedCell.dateLabel}`}
          assignmentIds={selectedCell.assignmentIds}
          selectedAssignmentId={selectedAssignmentId}
          onSelectAssignment={(assignmentId) => {
            void loadAssignmentDetailById(assignmentId);
          }}
        />
      ) : null}
    </>
  );
}

function Cover({ document }: { document: ReportDocument }) {
  if (!document.filters.display.includeCover) return null;
  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Relatórios de Plantões</h1>
          <p className="mt-1 text-sm text-slate-500">
            {document.facultyLabel} · {document.scopeLabel} · {document.periodLabel}
          </p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>Gerado em {formatBrazilDateTime(document.generatedAt)}</div>
          <div>{document.previewSummary.internCount} internos · {document.previewSummary.assignmentCount} plantões</div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-7">
        <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] uppercase text-slate-400">Horas</div><div className="text-xl font-semibold text-slate-900">{document.cover.totalHours}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] uppercase text-slate-400">Cumpridos</div><div className="text-xl font-semibold text-emerald-700">{document.cover.totalCompleted}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] uppercase text-slate-400">Agendados</div><div className="text-xl font-semibold text-slate-700">{document.cover.totalScheduled}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] uppercase text-slate-400">Ausências</div><div className="text-xl font-semibold text-rose-700">{document.cover.totalAbsences}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] uppercase text-slate-400">🏥 CRU</div><div className="text-xl font-semibold text-sky-700">{document.cover.totalCruCompleted}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] uppercase text-slate-400">🏨 CRL</div><div className="text-xl font-semibold text-violet-700">{document.cover.totalCrlCompleted}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] uppercase text-slate-400">🚑 USA</div><div className="text-xl font-semibold text-amber-700">{document.cover.totalUsaCompleted}</div></div>
      </div>

      {document.cover.belowTargetInterns.length > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-amber-900">Abaixo da meta</div>
            <div className="text-xs text-amber-800">{document.cover.belowTargetInterns.length} internos</div>
          </div>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-amber-200 bg-amber-100/30 p-2">
            <div className="flex flex-wrap gap-2">
            {document.cover.belowTargetInterns.map((intern) => (
              <span key={intern.internId} className="rounded-full bg-white px-3 py-1 text-xs text-amber-900 shadow-sm">
                {intern.internName}{intern.percentShifts !== null ? ` · ${intern.percentShifts}%` : ""}
              </span>
            ))}
            </div>
          </div>
        </div>
      ) : null}

      {document.cover.comparison.length > 1 ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-slate-900">Comparação entre turmas</div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {document.cover.comparison.map((item) => (
              <div key={item.cohortKey} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-sm font-semibold text-slate-900">{item.cohortLabel}</div>
                <div className="space-y-1 text-xs text-slate-600">
                  <div>{item.internCount} internos</div>
                  <div>Média de horas: {item.averageHours}</div>
                  <div>Taxa de ausência: {item.absenceRate}%</div>
                  <div>Meta cumprida: {item.metTargetPercent}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Heatmap document={document} />

      {document.warnings.length > 0 ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
          {document.warnings.map((warning) => (
            <div key={warning} className="mb-1 last:mb-0">{warning}</div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function InternCard({ document, intern }: { document: ReportDocument; intern: ReportInternDocument }) {
  const showSummary = document.filters.content.summary;
  const showCompleted = document.filters.content.completed;
  const showScheduled = document.filters.content.scheduled;
  const showAbsences = document.filters.content.absences;
  const showCaseRecords = document.filters.content.caseRecords;
  const showRequestHistory = document.filters.content.requestHistory;
  const showProgress = document.filters.content.progress;
  const hideEmptySections = document.filters.display.hideEmptySections;

  return (
    <article className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{intern.internName}</h2>
            <div className="mt-1 text-xs text-slate-500">{intern.facultyAbbr} · {intern.cohortLabel}</div>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>{intern.metrics.completed} cumpridos · {intern.metrics.scheduled} agendados · {intern.metrics.absences} ausências</div>
            <div>{intern.metrics.pendingRequests} pendências · {intern.metrics.rejectedRequests} reprovadas</div>
          </div>
        </div>
        {showSummary ? (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {intern.typeSummaryChips.length > 0 ? intern.typeSummaryChips.map((chip) => (
                <span key={chip} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm">{chip}</span>
              )) : <span className="text-xs text-slate-400">Nenhum plantão ainda</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {intern.statusSummaryChips.length > 0 ? intern.statusSummaryChips.map((chip) => (
                <span key={chip} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{chip}</span>
              )) : <span className="text-xs text-slate-400">Sem movimentação no período</span>}
            </div>
          </>
        ) : null}
      </div>

      <div className="space-y-5 px-5 py-5">
        {showProgress ? <ProgressBlock intern={intern} /> : null}

        {(showCompleted || showScheduled) ? intern.typeSections.map((section) => (
          <TypeSection
            key={section.key}
            section={{
              ...section,
              done: showCompleted ? section.done : [],
              scheduled: showScheduled ? section.scheduled : [],
            }}
            compactCompleted={document.filters.display.compactCompleted}
            hideEmptySections={hideEmptySections}
          />
        )) : null}

        {showAbsences && (!hideEmptySections || intern.absences.length > 0) ? (
          <SectionBlock title="Ausências" icon="⚠️" count={intern.absences.length} toneClass="bg-rose-50 text-rose-800">
            {intern.absences.length > 0 ? intern.absences.map((assignment) => (
              <AssignmentCard key={assignment.assignmentId} assignment={assignment} group="absent" compactCompleted={false} />
            )) : <div className="text-sm text-slate-400">Sem ausências no período.</div>}
          </SectionBlock>
        ) : null}

        {showCaseRecords && (!hideEmptySections || intern.caseRecordGroups.length > 0) ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Ocorrências clínicas registradas</div>
            {intern.caseRecordGroups.length > 0 ? (
              <div className="space-y-3">
                {intern.caseRecordGroups.map((group) => (
                  <div key={group.assignmentId} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.assignmentLabel}</div>
                    {group.records.map((record) => (
                      <div key={record.id} className="mb-2 rounded bg-white px-3 py-2 text-sm text-slate-700 last:mb-0">
                        <div className="font-medium text-slate-900">Caso {record.caseNumber} · {record.nickname}</div>
                        {record.description ? <div className="mt-1 text-xs text-slate-500">{record.description}</div> : null}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : <div className="text-sm text-slate-400">Sem ocorrências no período.</div>}
          </div>
        ) : null}

        {showRequestHistory && (!hideEmptySections || intern.requests.length > 0) ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Histórico de solicitações</div>
            {intern.requests.length > 0 ? (
              <div className="space-y-2">
                {intern.requests.map((request) => (
                  <div key={request.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <span className="rounded bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">{request.type}</span>
                    <span className="rounded bg-white px-2 py-0.5 text-xs text-slate-500">{request.status}</span>
                    <span className="text-xs text-slate-500">{formatBrazilDateTime(request.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : <div className="text-sm text-slate-400">Sem solicitações no período.</div>}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function AttendanceReportDocument({ document }: { document: ReportDocument }) {
  return (
    <div className="mx-auto max-w-7xl bg-slate-50 p-4 text-slate-900 md:p-6 print:bg-white print:p-0">
      <Cover document={document} />
      {document.interns.length > 0 ? document.interns.map((intern) => (
        <InternCard key={intern.internId} document={document} intern={intern} />
      )) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          Nenhum interno corresponde aos filtros atuais.
        </div>
      )}
    </div>
  );
}