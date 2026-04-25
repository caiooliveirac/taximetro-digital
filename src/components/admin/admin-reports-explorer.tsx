"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { BarChart3, Download, FileCode2, Filter, Loader2, MailPlus, Printer, Share2, Sparkles } from "lucide-react";
import { AttendanceReportDocument } from "@/components/reports/attendance-report-document";
import { Button } from "@/components/ui/button";
import { DEFAULT_REPORT_FILTERS, type ReportFilterInput } from "@/lib/report-filters";
import type { ReportCatalogIntern, ReportDocument } from "@/lib/admin-report-builder";

type CatalogData = {
  faculties: Array<{ id: string; abbr: string; name: string; rotationStartDate: string | null }>;
  interns: ReportCatalogIntern[];
};

type PreviewState = {
  document: ReportDocument;
  exportBaseName: string;
};

const SELECT_CLASS = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";
const INPUT_CLASS = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

function getInternCohortByGrouping(intern: ReportCatalogIntern, grouping: ReportFilterInput["cohortGrouping"]) {
  if (grouping === "ROTATION_7W") {
    return { key: intern.cohortRotationKey, label: intern.cohortRotationLabel };
  }
  if (grouping === "SEMESTER") {
    // Compatibilidade: SEMESTER antigo aponta para a divisão real por janela de rotação.
    return { key: intern.cohortRotationKey, label: intern.cohortRotationLabel };
  }
  return { key: intern.cohortMonthKey, label: intern.cohortMonthLabel };
}

function formatMonthDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function submitExport(format: "html" | "pdf", filters: ReportFilterInput) {
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(filters))));
  window.open(`/taximetro/admin/relatorios/export?format=${format}&filters=${encodeURIComponent(encoded)}`, "_blank", "noopener,noreferrer");
}

function DetailsSection({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-slate-200 bg-white">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-900">
        <div className="flex items-center justify-between">
          <span>{title}</span>
          <span className="text-xs text-slate-400 group-open:hidden">abrir</span>
          <span className="hidden text-xs text-slate-400 group-open:inline">fechar</span>
        </div>
      </summary>
      <div className="border-t border-slate-100 px-4 py-4">{children}</div>
    </details>
  );
}

export function AdminReportsExplorer({ catalog }: { catalog: CatalogData }) {
  const [filters, setFilters] = useState<ReportFilterInput>(DEFAULT_REPORT_FILTERS);
  const [internSearch, setInternSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const deferredInternSearch = useDeferredValue(internSearch);

  const facultyFilteredInterns = useMemo(() => {
    return catalog.interns.filter((intern) => !filters.facultyId || intern.facultyId === filters.facultyId);
  }, [catalog.interns, filters.facultyId]);

  const cohorts = useMemo(() => {
    const map = new Map<string, string>();
    for (const intern of facultyFilteredInterns) {
      const { key, label } = getInternCohortByGrouping(intern, filters.cohortGrouping);
      map.set(key, label);
    }
    return [...map.entries()].map(([key, label]) => ({ key, label })).sort((left, right) => right.key.localeCompare(left.key));
  }, [facultyFilteredInterns, filters.cohortGrouping]);

  const groupedInterns = useMemo(() => {
    const map = new Map<string, { label: string; interns: ReportCatalogIntern[] }>();
    const search = deferredInternSearch.trim().toLowerCase();
    for (const intern of facultyFilteredInterns) {
      if (search && !intern.internName.toLowerCase().includes(search)) continue;
      const { key, label } = getInternCohortByGrouping(intern, filters.cohortGrouping);
      const existing = map.get(key) ?? { label, interns: [] };
      existing.interns.push(intern);
      map.set(key, existing);
    }
    return [...map.entries()]
      .map(([key, value]) => ({ key, label: value.label, interns: value.interns.sort((left, right) => left.internName.localeCompare(right.internName)) }))
      .sort((left, right) => right.key.localeCompare(left.key));
  }, [deferredInternSearch, facultyFilteredInterns, filters.cohortGrouping]);

  const rotationCohorts = useMemo(() => {
    if (filters.cohortGrouping !== "ROTATION_7W") return [] as Array<{ key: string; label: string; index: number }>;
    return cohorts
      .map((cohort) => {
        const match = cohort.key.match(/-w(\d{2,})$/i);
        return {
          key: cohort.key,
          label: cohort.label,
          index: match ? Number(match[1]) : -1,
        };
      })
      .filter((cohort) => cohort.index > 0)
      .sort((left, right) => right.index - left.index || right.key.localeCompare(left.key));
  }, [cohorts, filters.cohortGrouping]);

  const currentRotationCohort = rotationCohorts[0] ?? null;
  const previousRotationCohort = rotationCohorts[1] ?? null;
  const penultimateRotationCohort = rotationCohorts[2] ?? null;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("/taximetro/api/reports/generate?format=json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filters }),
          signal: controller.signal,
        });
        const json = await response.json();
        if (!response.ok || !json.success) {
          throw new Error(json.error ?? "Erro ao gerar preview");
        }
        startTransition(() => {
          setPreview(json.data);
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Erro ao carregar preview");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [filters]);

  const visibleDocument = useMemo(() => {
    return preview?.document ?? null;
  }, [preview]);

  function setPreset(kind: "LAST_30" | "CURRENT_MONTH" | "LAST_MONTH" | "ROTATION" | "ALL") {
    const now = new Date();
    if (kind === "LAST_30") {
      const from = new Date();
      from.setDate(from.getDate() - 30);
      setFilters((prev) => ({ ...prev, from: formatMonthDate(from), to: formatMonthDate(now) }));
      return;
    }
    if (kind === "CURRENT_MONTH") {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      setFilters((prev) => ({ ...prev, from: formatMonthDate(from), to: formatMonthDate(now) }));
      return;
    }
    if (kind === "LAST_MONTH") {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      setFilters((prev) => ({ ...prev, from: formatMonthDate(from), to: formatMonthDate(to) }));
      return;
    }
    if (kind === "ROTATION") {
      const selectedFaculty = catalog.faculties.find((faculty) => faculty.id === filters.facultyId);
      const firstRotation = selectedFaculty?.rotationStartDate
        ?? catalog.faculties.map((faculty) => faculty.rotationStartDate).filter(Boolean).sort()[0]
        ?? new Date(new Date().setDate(new Date().getDate() - 90)).toISOString().slice(0, 10);
      setFilters((prev) => ({ ...prev, from: firstRotation, to: formatMonthDate(now) }));
      return;
    }
    const earliestCreatedAt = catalog.interns.map((intern) => intern.createdAt.slice(0, 10)).sort()[0] ?? new Date(new Date().setDate(new Date().getDate() - 90)).toISOString().slice(0, 10);
    setFilters((prev) => ({ ...prev, from: earliestCreatedAt, to: formatMonthDate(now) }));
  }

  function toggleIntern(internId: string) {
    setFilters((prev) => ({
      ...prev,
      selectedInternIds: prev.selectedInternIds.includes(internId)
        ? prev.selectedInternIds.filter((id) => id !== internId)
        : [...prev.selectedInternIds, internId],
    }));
  }

  function selectCohortInterns(cohortKey: string) {
    const ids = groupedInterns.find((group) => group.key === cohortKey)?.interns.map((intern) => intern.internId) ?? [];
    setFilters((prev) => ({
      ...prev,
      selectedInternIds: [...new Set([...prev.selectedInternIds, ...ids])],
    }));
  }

  function applyRotationShortcut(kind: "CURRENT" | "PREVIOUS" | "PENULTIMATE" | "CURRENT_AND_PREVIOUS") {
    if (kind === "CURRENT") {
      setFilters((prev) => ({
        ...prev,
        scopeMode: "COHORT",
        display: { ...prev.display, compareCohorts: false },
        selectedCohorts: currentRotationCohort ? [currentRotationCohort.key] : [],
      }));
      return;
    }
    if (kind === "PREVIOUS") {
      setFilters((prev) => ({
        ...prev,
        scopeMode: "COHORT",
        display: { ...prev.display, compareCohorts: false },
        selectedCohorts: previousRotationCohort ? [previousRotationCohort.key] : [],
      }));
      return;
    }
    if (kind === "PENULTIMATE") {
      setFilters((prev) => ({
        ...prev,
        scopeMode: "COHORT",
        display: { ...prev.display, compareCohorts: false },
        selectedCohorts: penultimateRotationCohort ? [penultimateRotationCohort.key] : [],
      }));
      return;
    }
    setFilters((prev) => ({
      ...prev,
      scopeMode: "COHORT",
      selectedCohorts: [currentRotationCohort?.key, previousRotationCohort?.key].filter(Boolean) as string[],
      display: { ...prev.display, compareCohorts: true },
    }));
  }

  function renderFilters() {
    return (
      <div className="space-y-4">
        <DetailsSection title="1. Período do relatório" defaultOpen>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <label className="block text-sm text-slate-700">
              <span className="text-xs font-medium text-slate-500">De</span>
              <input className={INPUT_CLASS} type="date" value={filters.from} onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))} />
            </label>
            <label className="block text-sm text-slate-700">
              <span className="text-xs font-medium text-slate-500">Até</span>
              <input className={INPUT_CLASS} type="date" value={filters.to} onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setPreset("LAST_30")}>Últimos 30 dias</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("CURRENT_MONTH")}>Mês atual</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("LAST_MONTH")}>Mês passado</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("ROTATION")}>Rodízio atual</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("ALL")}>Tudo</Button>
          </div>
          <p className="mt-3 text-xs text-amber-700">Rodízio usa `rotationStartDate` da faculdade quando disponível; sem entidade completa de rodízio, a meta proporcional fica sinalizada no relatório.</p>
        </DetailsSection>

        <DetailsSection title="2. Faculdade" defaultOpen>
          <label className="block text-sm text-slate-700">
            <span className="text-xs font-medium text-slate-500">Faculdade</span>
            <select className={SELECT_CLASS} value={filters.facultyId ?? ""} onChange={(event) => setFilters((prev) => ({ ...prev, facultyId: event.target.value || null }))}>
              <option value="">Todas</option>
              {catalog.faculties.map((faculty) => (
                <option key={faculty.id} value={faculty.id}>{faculty.abbr}</option>
              ))}
            </select>
          </label>
        </DetailsSection>

        <DetailsSection title="3. Escopo de internos" defaultOpen>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: "COHORT", label: "Turma inteira" },
              { key: "SPECIFIC_INTERNS", label: "Internos específicos" },
              { key: "PERFORMANCE", label: "Por performance" },
              { key: "ALL_FACULTY", label: "Todos da faculdade" },
            ].map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`rounded-lg border px-3 py-2 text-left text-sm ${filters.scopeMode === mode.key ? "border-accent-500 bg-accent-50 text-accent-700" : "border-slate-200 bg-white text-slate-700"}`}
                onClick={() => setFilters((prev) => ({ ...prev, scopeMode: mode.key as ReportFilterInput["scopeMode"] }))}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {filters.cohortGrouping === "ROTATION_7W" ? (
            <div className="mt-4 space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
              <div className="text-xs font-medium text-sky-800">Atalho de turma (rotação)</div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => applyRotationShortcut("CURRENT")} disabled={!currentRotationCohort}>
                  Atual
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => applyRotationShortcut("PREVIOUS")} disabled={!previousRotationCohort}>
                  Anterior
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => applyRotationShortcut("PENULTIMATE")} disabled={!penultimateRotationCohort}>
                  Penúltima
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => applyRotationShortcut("CURRENT_AND_PREVIOUS")} disabled={!currentRotationCohort || !previousRotationCohort}>
                  Atual + anterior
                </Button>
              </div>
              <div className="text-[11px] text-sky-700">
                {currentRotationCohort ? `Atual: ${currentRotationCohort.label}` : "Atual: indisponível"}
              </div>
              <div className="text-[11px] text-sky-700">
                {previousRotationCohort ? `Anterior: ${previousRotationCohort.label}` : "Anterior: indisponível"}
              </div>
            </div>
          ) : null}

          {filters.scopeMode === "COHORT" ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Turmas inferidas por janela de execução real de plantões (7 semanas), ancorada em rotationStartDate quando disponível.
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={filters.display.compareCohorts} onChange={(event) => setFilters((prev) => ({ ...prev, display: { ...prev.display, compareCohorts: event.target.checked }, selectedCohorts: [] }))} />
                Comparar turmas
              </label>
              <label className="block text-sm text-slate-700">
                <span className="text-xs font-medium text-slate-500">Agrupamento</span>
                <select className={SELECT_CLASS} value={filters.cohortGrouping} onChange={(event) => setFilters((prev) => ({ ...prev, cohortGrouping: event.target.value as ReportFilterInput["cohortGrouping"], selectedCohorts: [] }))}>
                  <option value="ROTATION_7W">Ciclo de rotação (7 semanas)</option>
                  <option value="MONTH">Mês</option>
                </select>
              </label>
              {!filters.display.compareCohorts ? (
                <label className="block text-sm text-slate-700">
                  <span className="text-xs font-medium text-slate-500">Turma</span>
                  <select className={SELECT_CLASS} value={filters.selectedCohorts[0] ?? ""} onChange={(event) => setFilters((prev) => ({ ...prev, selectedCohorts: event.target.value ? [event.target.value] : [] }))}>
                    <option value="">Todas</option>
                    {cohorts.map((cohort) => (
                      <option key={cohort.key} value={cohort.key}>{cohort.label}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {cohorts.map((cohort) => (
                    <label key={cohort.key} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={filters.selectedCohorts.includes(cohort.key)}
                        onChange={(event) => setFilters((prev) => ({
                          ...prev,
                          selectedCohorts: event.target.checked ? [...prev.selectedCohorts, cohort.key] : prev.selectedCohorts.filter((key) => key !== cohort.key),
                        }))}
                      />
                      {cohort.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {filters.scopeMode === "SPECIFIC_INTERNS" ? (
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-slate-700">
                <span className="text-xs font-medium text-slate-500">Buscar interno</span>
                <input className={INPUT_CLASS} value={internSearch} onChange={(event) => setInternSearch(event.target.value)} placeholder="Digite um nome" />
              </label>
              <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                {groupedInterns.map((group) => (
                  <div key={group.key} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{group.label}</div>
                        <div className="text-xs text-slate-500">{group.interns.length} internos</div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => selectCohortInterns(group.key)}>Selecionar turma</Button>
                    </div>
                    <div className="space-y-2">
                      {group.interns.map((intern) => (
                        <label key={intern.internId} className="flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" checked={filters.selectedInternIds.includes(intern.internId)} onChange={() => toggleIntern(intern.internId)} />
                          <span>{intern.internName}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-slate-500">{filters.selectedInternIds.length} selecionados</div>
            </div>
          ) : null}
        </DetailsSection>

        <DetailsSection title="4. Filtros de performance">
          <div className={`space-y-3 ${filters.scopeMode === "PERFORMANCE" ? "opacity-100" : "opacity-50"}`}>
            {[
              ["belowHoursTarget", "Não atingiram a meta de horas", "Usa meta absoluta; não há data final modelada do rodízio."],
              ["belowShiftsTarget", "Não atingiram a meta de plantões", "Usa meta absoluta; sem fator proporcional formal."],
              ["hasAbsences", "Têm ausências", "Pelo menos um plantão classificado como ausência."],
              ["hasPendingRequests", "Têm pendências", "Requests com status PENDING ou ESCALATED."],
              ["hasRejectedRequests", "Têm trocas reprovadas", "Requests REJECTED no período."],
              ["aboveTarget", "Estão acima da meta", "Horas cumpridas acima da meta absoluta."],
              ["noCheckinInPeriod", "Sem nenhum check-in no período", "Sem plantão concluído, agendado ou ausência no recorte."],
            ].map(([key, label, tooltip]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-700" title={tooltip}>
                <input
                  type="checkbox"
                  disabled={filters.scopeMode !== "PERFORMANCE"}
                  checked={filters.performance[key as keyof ReportFilterInput["performance"]] as boolean}
                  onChange={(event) => setFilters((prev) => ({ ...prev, performance: { ...prev.performance, [key]: event.target.checked } }))}
                />
                {label}
              </label>
            ))}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700" title="Internos com mais que N ausências no período.">
                <input
                  type="checkbox"
                  disabled={filters.scopeMode !== "PERFORMANCE"}
                  checked={filters.performance.moreThanNAbsences}
                  onChange={(event) => setFilters((prev) => ({ ...prev, performance: { ...prev.performance, moreThanNAbsences: event.target.checked } }))}
                />
                Têm mais de N ausências
              </label>
              <input
                className="w-20 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                type="number"
                min={1}
                value={filters.performance.absencesThreshold}
                onChange={(event) => setFilters((prev) => ({ ...prev, performance: { ...prev.performance, absencesThreshold: Number(event.target.value) || 2 } }))}
                disabled={filters.scopeMode !== "PERFORMANCE"}
              />
            </div>
          </div>
        </DetailsSection>

        <DetailsSection title="5. Conteúdo do relatório">
          <div className="grid gap-2 text-sm text-slate-700">
            {[
              ["summary", "Sumário"],
              ["completed", "Cumpridos"],
              ["scheduled", "Agendados"],
              ["absences", "Ausências"],
              ["caseRecords", "Ocorrências clínicas registradas"],
              ["requestHistory", "Histórico de solicitações"],
              ["progress", "Progresso vs meta"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input type="checkbox" checked={filters.content[key as keyof ReportFilterInput["content"]]} onChange={(event) => setFilters((prev) => ({ ...prev, content: { ...prev.content, [key]: event.target.checked } }))} />
                {label}
              </label>
            ))}
          </div>
        </DetailsSection>

        <DetailsSection title="6. Ordenação dos internos">
          <select className={SELECT_CLASS} value={filters.orderBy} onChange={(event) => setFilters((prev) => ({ ...prev, orderBy: event.target.value as ReportFilterInput["orderBy"] }))}>
            <option value="ALPHABETICAL">Alfabética</option>
            <option value="COHORT_THEN_ALPHABETICAL">Por turma + alfabética</option>
            <option value="META_PERCENT_ASC">Por % de meta cumprida (asc)</option>
            <option value="ABSENCES_DESC">Por número de ausências (desc)</option>
            <option value="HOURS_DESC">Por horas cumpridas (desc)</option>
          </select>
        </DetailsSection>

        <DetailsSection title="7. Detalhes de exibição">
          <div className="grid gap-2 text-sm text-slate-700">
            <label className="flex items-center gap-2"><input type="checkbox" checked={filters.display.compactCompleted} onChange={(event) => setFilters((prev) => ({ ...prev, display: { ...prev.display, compactCompleted: event.target.checked } }))} /> Compactar plantões finalizados</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={filters.display.hideEmptySections} onChange={(event) => setFilters((prev) => ({ ...prev, display: { ...prev.display, hideEmptySections: event.target.checked } }))} /> Esconder seções vazias</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={filters.display.includeCover} onChange={(event) => setFilters((prev) => ({ ...prev, display: { ...prev.display, includeCover: event.target.checked } }))} /> Incluir capa com sumário consolidado</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={filters.display.showHeatmap} onChange={(event) => setFilters((prev) => ({ ...prev, display: { ...prev.display, showHeatmap: event.target.checked } }))} /> Heatmap de presença</label>
          </div>
        </DetailsSection>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="sticky top-0 z-20 rounded-2xl border border-slate-200 bg-white/95 px-4 py-4 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-slate-900">
              <BarChart3 className="h-5 w-5 text-accent-500" />
              <h1 className="text-xl font-semibold">Relatórios de Plantões</h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">Filtros à esquerda, preview ao vivo à direita. Exportação usa exatamente o estado atual.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setMobileFiltersOpen(true)} className="lg:hidden"><Filter className="h-4 w-4" /> Filtros</Button>
            <Button variant="outline" size="sm" onClick={() => submitExport("html", filters)}><FileCode2 className="h-4 w-4" /> HTML</Button>
            <Button variant="outline" size="sm" onClick={() => submitExport("pdf", filters)}><Printer className="h-4 w-4" /> PDF</Button>
            <Button variant="outline" size="sm" disabled title="Em breve"><MailPlus className="h-4 w-4" /> Agendar</Button>
            <Button variant="outline" size="sm" disabled title="Requer schema novo para report_presets"><Sparkles className="h-4 w-4" /> Preset</Button>
            <Button variant="outline" size="sm" disabled title="Requer schema novo para link assinado"><Share2 className="h-4 w-4" /> Compartilhar</Button>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-400">PDF usa o modo de impressão do navegador porque o repositório ainda não tem renderer server-side.</div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
            {renderFilters()}
          </div>
        </aside>

        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="sticky top-24 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 text-sm backdrop-blur">
            <div className="text-slate-600">
              Mostrando <strong>{preview?.document.previewSummary.internCount ?? 0}</strong> internos · <strong>{preview?.document.previewSummary.assignmentCount ?? 0}</strong> plantões · Período: {filters.from.split("-").reverse().join("/")} a {filters.to.split("-").reverse().join("/")}
            </div>
          </div>

          <div className="max-h-[calc(100vh-11rem)] overflow-y-auto p-4">
            {loading ? (
              <div className="space-y-4">
                <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
                <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
                <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">{error}</div>
            ) : visibleDocument ? (
              <AttendanceReportDocument document={visibleDocument} />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Sem preview.</div>
            )}
          </div>
        </section>
      </div>

      {mobileFiltersOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-slate-900/40" aria-label="Fechar filtros" onClick={() => setMobileFiltersOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-[92vw] max-w-md overflow-y-auto border-l border-slate-200 bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-lg font-semibold text-slate-900">Filtros</div>
              <Button size="sm" variant="outline" onClick={() => setMobileFiltersOpen(false)}>Fechar</Button>
            </div>
            {renderFilters()}
          </div>
        </div>
      ) : null}
    </div>
  );
}