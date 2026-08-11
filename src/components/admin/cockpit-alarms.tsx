"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Info, AlertCircle, ClipboardList, Clock, CheckCircle2 } from "lucide-react";
import { getFacultyStyle } from "@/lib/base-colors";
import { InternDrawer } from "@/components/admin/intern-drawer";
import { AbsenceQuickModal } from "@/components/admin/absence-quick-modal";

export type WeekBreakdown = {
  type: "USA" | "CRU" | "CRL";
  completed: number;
  target: number;
  below: boolean;
};

export type AlarmItem = {
  internId: string;
  internName: string;
  facultyAbbr: string;
  detail: string;
  breakdown?: WeekBreakdown[];
};

export type AbsenceAlertItem = {
  assignmentId: string;
  internId: string;
  internName: string;
  facultyAbbr: string;
  baseCode: string;
  baseName: string;
  period: "DAY" | "NIGHT";
  date: string;
  hasJustification: boolean;
  justification: string | null;
  justifiedBy: string | null;
  justifiedAt: string | null;
};

export type CockpitData = {
  noCheckin: { count: number; items: AlarmItem[] };
  unreplacedAbsence: { count: number; items: AlarmItem[] };
  absenceAlerts: { count: number; items: AbsenceAlertItem[] };
};

type AlarmCardProps = {
  id: "noCheckin" | "unreplacedAbsence";
  title: string;
  items: AlarmItem[];
  severity: "danger" | "warning" | "info";
  Icon: typeof AlertCircle;
  caveat?: string;
  expanded: boolean;
  onToggle: () => void;
  onItemClick: (item: AlarmItem) => void;
  facultyFilter: string | null;
  // Quando true e sem facultyFilter e há ≥2 faculdades, agrupa visualmente.
  groupByFaculty?: boolean;
};

const SEVERITY_STYLES: Record<"danger" | "warning" | "info", { ring: string; bg: string; iconBg: string; iconColor: string; numColor: string; chev: string }> = {
  danger: {
    ring: "ring-red-200 hover:ring-red-300",
    bg: "bg-red-50/40",
    iconBg: "bg-red-100",
    iconColor: "text-red-600",
    numColor: "text-red-700",
    chev: "text-red-400",
  },
  warning: {
    ring: "ring-amber-200 hover:ring-amber-300",
    bg: "bg-amber-50/40",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    numColor: "text-amber-700",
    chev: "text-amber-400",
  },
  // Informativo (não acionável por si só). Uso: meta semanal sob a ótica de
  // ritmo, em complemento ao alarme principal de saldo da rotação.
  info: {
    ring: "ring-slate-200 hover:ring-slate-300",
    bg: "bg-slate-50/40",
    iconBg: "bg-slate-100",
    iconColor: "text-slate-500",
    numColor: "text-slate-700",
    chev: "text-slate-400",
  },
};

const PEEK_SIZE = 5;

function renderItemRow(it: AlarmItem, id: string, onItemClick: (item: AlarmItem) => void) {
  const fst = getFacultyStyle(it.facultyAbbr);
  return (
    <li key={`${id}-${it.internId}`}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onItemClick(it);
        }}
        className="group flex w-full items-center justify-between gap-2 px-4 py-2 text-left transition-colors hover:bg-white/70"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-800 group-hover:text-slate-900">{it.internName}</span>
          {it.facultyAbbr && (
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fst.pill}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
              {it.facultyAbbr}
            </span>
          )}
        </div>
        <span className="shrink-0 text-xs">
          {it.breakdown && it.breakdown.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              {it.detail && (
                <>
                  <span className="font-medium text-slate-600">{it.detail}</span>
                  <span className="text-slate-300">·</span>
                </>
              )}
              {it.breakdown.map((b, idx) => (
                <span
                  key={`${id}-${it.internId}-${b.type}`}
                  className={b.below ? "font-semibold text-red-700" : "text-slate-500"}
                >
                  {idx > 0 && <span className="mx-1 text-slate-300">·</span>}
                  {b.type} {b.completed}/{b.target}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-slate-500">{it.detail}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function AlarmCard({ id, title, items, severity, Icon, caveat, expanded, onToggle, onItemClick, facultyFilter, groupByFaculty }: AlarmCardProps) {
  const s = SEVERITY_STYLES[severity];
  const filtered = facultyFilter ? items.filter((it) => it.facultyAbbr === facultyFilter) : items;
  const visibleCount = filtered.length;
  const hasItems = visibleCount > 0;
  const [showAll, setShowAll] = useState(false);

  const visibleItems = showAll ? filtered : filtered.slice(0, PEEK_SIZE);
  const hasMore = visibleCount > PEEK_SIZE;

  // Agrupa por faculdade quando: groupByFaculty=true, sem filtro ativo, e ≥2 faculdades distintas.
  const distinctFaculties = new Set(visibleItems.map((it) => it.facultyAbbr || "?"));
  const renderGrouped = !!groupByFaculty && !facultyFilter && distinctFaculties.size >= 2;

  const grouped = renderGrouped
    ? visibleItems.reduce<Map<string, AlarmItem[]>>((acc, it) => {
        const key = it.facultyAbbr || "?";
        const list = acc.get(key) ?? [];
        list.push(it);
        acc.set(key, list);
        return acc;
      }, new Map())
    : null;

  return (
    <div
      className={`rounded-xl bg-white ring-1 transition-all duration-200 ${
        hasItems ? `${s.ring} ${s.bg} shadow-[0_1px_3px_rgba(0,0,0,0.04)]` : "ring-slate-200"
      }`}
      data-alarm-id={id}
    >
      <button
        onClick={onToggle}
        disabled={!hasItems}
        className={`w-full px-4 py-3.5 text-left ${hasItems ? "cursor-pointer hover:brightness-[0.98]" : "cursor-default opacity-70"}`}
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${s.iconBg}`}>
            <Icon className={`h-5 w-5 ${s.iconColor}`} strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">{title}</p>
              {caveat && (
                <span
                  className="inline-flex items-center text-slate-400 hover:text-slate-600"
                  title={caveat}
                  aria-label={caveat}
                >
                  <Info className="h-3 w-3" strokeWidth={2} />
                </span>
              )}
            </div>
            <p className={`mt-0.5 text-3xl font-bold tabular-nums leading-none ${hasItems ? s.numColor : "text-slate-300"}`}>
              {visibleCount}
            </p>
          </div>
          {hasItems && (
            <div className={`shrink-0 self-end ${s.chev}`}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          )}
        </div>
      </button>

      {expanded && hasItems && (
        <div className="border-t border-slate-200/60">
          {grouped ? (
            <div className="divide-y divide-slate-200/60">
              {[...grouped.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([abbr, list]) => {
                  const fst = getFacultyStyle(abbr);
                  return (
                    <div key={`${id}-grp-${abbr}`}>
                      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-50/60">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${fst.pill}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                          {abbr || "Sem faculdade"}
                        </span>
                        <span className="text-[10px] tabular-nums text-slate-500">{list.length}</span>
                      </div>
                      <ul className="divide-y divide-slate-100/80">
                        {list.map((it) => renderItemRow(it, id, onItemClick))}
                      </ul>
                    </div>
                  );
                })}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100/80">
              {visibleItems.map((it) => renderItemRow(it, id, onItemClick))}
            </ul>
          )}
          {hasMore && (
            <div className="border-t border-slate-200/60 px-4 py-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAll((v) => !v);
                }}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-white/70 hover:text-slate-900"
              >
                {showAll ? (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    Mostrar só {PEEK_SIZE}
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    Mostrar todos ({visibleCount})
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatShortDate(iso: string): string {
  // YYYY-MM-DD → DD/MM
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
}

const PERIOD_LABEL: Record<"DAY" | "NIGHT", string> = { DAY: "diurno", NIGHT: "noturno" };

type AbsenceCardProps = {
  items: AbsenceAlertItem[];
  expanded: boolean;
  onToggle: () => void;
  onItemClick: (item: AbsenceAlertItem) => void;
  facultyFilter: string | null;
};

// Card "Faltas pendentes": estrutura de 2 sub-blocos (sem-justificativa /
// justificadas), cada um agrupado por faculdade e alfabético dentro.
// Cor do card é dinâmica: red se há ≥1 sem-justificativa, amber se só
// justificadas. Click numa linha abre AbsenceQuickModal pra ação per-falta.
function AbsenceAlertsCard({ items, expanded, onToggle, onItemClick, facultyFilter }: AbsenceCardProps) {
  const filtered = facultyFilter ? items.filter((it) => it.facultyAbbr === facultyFilter) : items;
  const unjustified = filtered.filter((it) => !it.hasJustification);
  const justified = filtered.filter((it) => it.hasJustification);

  const visibleCount = filtered.length;
  const hasItems = visibleCount > 0;
  const severity: "danger" | "warning" | "info" = unjustified.length > 0 ? "danger" : justified.length > 0 ? "warning" : "info";
  const s = SEVERITY_STYLES[severity];

  function groupAndSort(list: AbsenceAlertItem[]) {
    const map = new Map<string, AbsenceAlertItem[]>();
    for (const it of list) {
      const key = it.facultyAbbr || "?";
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([abbr, arr]) => ({
        abbr,
        items: [...arr].sort((a, b) => a.internName.localeCompare(b.internName)),
      }));
  }

  const unjustifiedGroups = groupAndSort(unjustified);
  const justifiedGroups = groupAndSort(justified);

  return (
    <div
      className={`rounded-xl bg-white ring-1 transition-all duration-200 ${
        hasItems ? `${s.ring} ${s.bg} shadow-[0_1px_3px_rgba(0,0,0,0.04)]` : "ring-slate-200"
      }`}
      data-alarm-id="absenceAlerts"
    >
      <button
        onClick={onToggle}
        disabled={!hasItems}
        className={`w-full px-4 py-3.5 text-left ${hasItems ? "cursor-pointer hover:brightness-[0.98]" : "cursor-default opacity-70"}`}
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${s.iconBg}`}>
            <ClipboardList className={`h-5 w-5 ${s.iconColor}`} strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Faltas pendentes</p>
            <p className={`mt-0.5 text-3xl font-bold tabular-nums leading-none ${hasItems ? s.numColor : "text-slate-300"}`}>
              {visibleCount}
            </p>
            {hasItems && (unjustified.length > 0 || justified.length > 0) && (
              <p className="mt-1 text-[10px] tabular-nums text-slate-500">
                {unjustified.length > 0 && (
                  <span className="font-semibold text-red-700">{unjustified.length} sem justif.</span>
                )}
                {unjustified.length > 0 && justified.length > 0 && <span className="mx-1 text-slate-300">·</span>}
                {justified.length > 0 && (
                  <span className="font-semibold text-amber-700">{justified.length} justif.</span>
                )}
              </p>
            )}
          </div>
          {hasItems && (
            <div className={`shrink-0 self-end ${s.chev}`}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          )}
        </div>
      </button>

      {expanded && hasItems && (
        <div className="border-t border-slate-200/60">
          {unjustifiedGroups.length > 0 && (
            <AbsenceSection
              label="Sem justificativa"
              accent="text-red-700"
              groups={unjustifiedGroups}
              onItemClick={onItemClick}
            />
          )}
          {justifiedGroups.length > 0 && (
            <AbsenceSection
              label="Justificadas"
              accent="text-amber-700"
              groups={justifiedGroups}
              onItemClick={onItemClick}
            />
          )}
        </div>
      )}
    </div>
  );
}

function AbsenceSection({
  label,
  accent,
  groups,
  onItemClick,
}: {
  label: string;
  accent: string;
  groups: { abbr: string; items: AbsenceAlertItem[] }[];
  onItemClick: (item: AbsenceAlertItem) => void;
}) {
  return (
    <div className="border-b border-slate-200/60 last:border-b-0">
      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-50/80">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${accent}`}>{label}</span>
        <span className="text-[10px] tabular-nums text-slate-500">
          {groups.reduce((acc, g) => acc + g.items.length, 0)}
        </span>
      </div>
      <div className="divide-y divide-slate-200/60">
        {groups.map(({ abbr, items }) => {
          const fst = getFacultyStyle(abbr);
          return (
            <div key={`abs-${label}-${abbr}`}>
              <div className="flex items-center justify-between px-4 py-1.5 bg-slate-50/40">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${fst.pill}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                  {abbr || "Sem faculdade"}
                </span>
                <span className="text-[10px] tabular-nums text-slate-500">{items.length}</span>
              </div>
              <ul className="divide-y divide-slate-100/80">
                {items.map((it) => (
                  <li key={`abs-${it.assignmentId}`}>
                    <button
                      onClick={() => onItemClick(it)}
                      className="group flex w-full items-center justify-between gap-2 px-4 py-2 text-left transition-colors hover:bg-white/70"
                    >
                      <span className="truncate text-sm font-medium text-slate-800 group-hover:text-slate-900">{it.internName}</span>
                      <span className="shrink-0 text-xs tabular-nums text-slate-500">
                        {formatShortDate(it.date)} · {it.baseCode} · {PERIOD_LABEL[it.period]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CockpitAlarms({
  data,
  facultyFilter,
}: {
  data: CockpitData;
  facultyFilter: string | null;
}) {
  // Expansão é global: clicar em qualquer card expande/recolhe todos os 3
  // (facilita varredura visual e printscreen para repassar ao líder).
  const [allExpanded, setAllExpanded] = useState(false);
  const [modalIntern, setModalIntern] = useState<AlarmItem | null>(null);
  const [modalAbsence, setModalAbsence] = useState<AbsenceAlertItem | null>(null);

  function applyFilter<T extends { facultyAbbr: string }>(items: T[]): T[] {
    return facultyFilter ? items.filter((it) => it.facultyAbbr === facultyFilter) : items;
  }

  const noCheckinFiltered = applyFilter(data.noCheckin.items);
  const unreplacedFiltered = applyFilter(data.unreplacedAbsence.items);
  const absenceAlertsFiltered = applyFilter(data.absenceAlerts.items);
  const unjustifiedCount = absenceAlertsFiltered.filter((it) => !it.hasJustification).length;
  const justifiedCount = absenceAlertsFiltered.length - unjustifiedCount;
  // "Acionáveis" = vermelhos (sem check-in agora + atraso sem cobertura
  // + faltas SEM justificativa). "A conferir" = faltas justificadas.
  const actionableCount = noCheckinFiltered.length + unreplacedFiltered.length + unjustifiedCount;
  const reviewCount = justifiedCount;
  const totalShown = actionableCount + reviewCount;

  function toggleAll() {
    setAllExpanded((v) => !v);
  }

  if (totalShown === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-sm font-semibold text-emerald-900">Sem alarmes ativos</p>
          <p className="text-xs text-emerald-700/80">
            {facultyFilter
              ? `Todos os internos de ${facultyFilter} estão no ritmo.`
              : "Todos os internos estão no ritmo."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Alarmes ativos</p>
          <p className="text-[10px] text-slate-400">
            {actionableCount === 0
              ? "Nenhum acionável"
              : `${actionableCount} ${actionableCount === 1 ? "acionável" : "acionáveis"}`}
            {reviewCount > 0 && (
              <span className="ml-1 text-slate-300">· {reviewCount} a conferir</span>
            )}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <AlarmCard
            id="noCheckin"
            title="Sem check-in agora"
            items={data.noCheckin.items}
            severity="danger"
            Icon={Clock}
            expanded={allExpanded}
            onToggle={toggleAll}
            onItemClick={setModalIntern}
            facultyFilter={facultyFilter}
          />
          <AlarmCard
            id="unreplacedAbsence"
            title="Atraso sem cobertura"
            items={data.unreplacedAbsence.items}
            severity="danger"
            Icon={AlertCircle}
            expanded={allExpanded}
            onToggle={toggleAll}
            onItemClick={setModalIntern}
            facultyFilter={facultyFilter}
            groupByFaculty
          />
          <AbsenceAlertsCard
            items={data.absenceAlerts.items}
            expanded={allExpanded}
            onToggle={toggleAll}
            onItemClick={setModalAbsence}
            facultyFilter={facultyFilter}
          />
        </div>
      </div>

      {modalIntern && (
        <InternDrawer
          internId={modalIntern.internId}
          internName={modalIntern.internName}
          facultyAbbr={modalIntern.facultyAbbr}
          onClose={() => setModalIntern(null)}
        />
      )}

      {modalAbsence && (
        <AbsenceQuickModal
          absence={modalAbsence}
          onClose={() => setModalAbsence(null)}
        />
      )}
    </>
  );
}
