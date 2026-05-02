"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Info, AlertCircle, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { getFacultyStyle } from "@/lib/base-colors";
import { InternQuickModal } from "@/components/admin/intern-quick-modal";

export type AlarmItem = {
  internId: string;
  internName: string;
  facultyAbbr: string;
  detail: string;
};

export type CockpitData = {
  noCheckin: { count: number; items: AlarmItem[] };
  unreplacedAbsence: { count: number; items: AlarmItem[] };
  belowWeeklyTarget: { count: number; items: AlarmItem[] };
};

type AlarmCardProps = {
  id: "noCheckin" | "unreplacedAbsence" | "belowWeeklyTarget";
  title: string;
  items: AlarmItem[];
  severity: "danger" | "warning";
  Icon: typeof AlertCircle;
  caveat?: string;
  expanded: boolean;
  onToggle: () => void;
  onItemClick: (item: AlarmItem) => void;
  facultyFilter: string | null;
};

const SEVERITY_STYLES: Record<"danger" | "warning", { ring: string; bg: string; iconBg: string; iconColor: string; numColor: string; chev: string }> = {
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
};

const PEEK_SIZE = 5;

function AlarmCard({ id, title, items, severity, Icon, caveat, expanded, onToggle, onItemClick, facultyFilter }: AlarmCardProps) {
  const s = SEVERITY_STYLES[severity];
  const filtered = facultyFilter ? items.filter((it) => it.facultyAbbr === facultyFilter) : items;
  const visibleCount = filtered.length;
  const hasItems = visibleCount > 0;
  const [showAll, setShowAll] = useState(false);

  const visibleItems = showAll ? filtered : filtered.slice(0, PEEK_SIZE);
  const hasMore = visibleCount > PEEK_SIZE;

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
          <ul
            className={`divide-y divide-slate-100/80 ${
              showAll && visibleCount > PEEK_SIZE ? "max-h-[60vh] overflow-y-auto" : ""
            }`}
          >
            {visibleItems.map((it) => {
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
                    <span className="shrink-0 text-xs text-slate-500">{it.detail}</span>
                  </button>
                </li>
              );
            })}
          </ul>
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

const ALARM_CAVEAT_WEEKLY =
  "Considera meta fixa por faculdade. Em faculdades de alocação incremental (ex: UNIFACS), pode incluir interno ainda não alocado pra semana — verificar individualmente.";

export function CockpitAlarms({
  data,
  facultyFilter,
}: {
  data: CockpitData;
  facultyFilter: string | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modalIntern, setModalIntern] = useState<AlarmItem | null>(null);

  function applyFilter(items: AlarmItem[]): AlarmItem[] {
    return facultyFilter ? items.filter((it) => it.facultyAbbr === facultyFilter) : items;
  }

  const noCheckinFiltered = applyFilter(data.noCheckin.items);
  const unreplacedFiltered = applyFilter(data.unreplacedAbsence.items);
  const belowWeeklyFiltered = applyFilter(data.belowWeeklyTarget.items);
  const totalActive = noCheckinFiltered.length + unreplacedFiltered.length + belowWeeklyFiltered.length;

  function toggle(id: string) {
    setExpanded((curr) => (curr === id ? null : id));
  }

  if (totalActive === 0) {
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
            {totalActive} {totalActive === 1 ? "alarme" : "alarmes"}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <AlarmCard
            id="noCheckin"
            title="Sem check-in agora"
            items={data.noCheckin.items}
            severity="danger"
            Icon={Clock}
            expanded={expanded === "noCheckin"}
            onToggle={() => toggle("noCheckin")}
            onItemClick={setModalIntern}
            facultyFilter={facultyFilter}
          />
          <AlarmCard
            id="unreplacedAbsence"
            title="Faltou sem reposição"
            items={data.unreplacedAbsence.items}
            severity="danger"
            Icon={AlertCircle}
            expanded={expanded === "unreplacedAbsence"}
            onToggle={() => toggle("unreplacedAbsence")}
            onItemClick={setModalIntern}
            facultyFilter={facultyFilter}
          />
          <AlarmCard
            id="belowWeeklyTarget"
            title="Abaixo da meta semanal"
            items={data.belowWeeklyTarget.items}
            severity="warning"
            Icon={AlertTriangle}
            caveat={ALARM_CAVEAT_WEEKLY}
            expanded={expanded === "belowWeeklyTarget"}
            onToggle={() => toggle("belowWeeklyTarget")}
            onItemClick={setModalIntern}
            facultyFilter={facultyFilter}
          />
        </div>
      </div>

      {modalIntern && (
        <InternQuickModal
          internId={modalIntern.internId}
          internName={modalIntern.internName}
          facultyAbbr={modalIntern.facultyAbbr}
          onClose={() => setModalIntern(null)}
        />
      )}
    </>
  );
}
