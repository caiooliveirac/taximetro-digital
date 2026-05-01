import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assignments,
  bases,
  caseRecords,
  checkins,
  cohorts,
  faculties,
  requests,
  rotationTransitions,
  userRoles,
  users,
} from "@/db/schema";
import type { CohortGrouping, ReportFilterInput, ReportOrderBy } from "@/lib/report-filters";
import { sumAssignmentHours } from "@/lib/utils";

export type ReportAssignmentGroup = "done" | "scheduled" | "absent";
export type ReportTypeKey = "CENTRAL" | "CRL" | "USA";

export type ReportCatalogIntern = {
  internId: string;
  internName: string;
  facultyId: string | null;
  facultyAbbr: string | null;
  facultyName: string | null;
  createdAt: string;
  cohortId: string | null;
  cohortName: string | null;
  cohortMonthKey: string;
  cohortMonthLabel: string;
  cohortSemesterKey: string;
  cohortSemesterLabel: string;
  cohortRotationKey: string;
  cohortRotationLabel: string;
  rotationStartDate: string | null;
  firstAssignmentDate: string | null;
  targetHours: number;
  targetShifts: number;
};

type AssignmentRow = {
  assignmentId: string;
  internId: string;
  date: string;
  period: string;
  baseCode: string;
  baseName: string;
  baseType: string | null;
  status: string;
  shift: string | null;
  checkinAt: string | null;
  checkoutAt: string | null;
  absenceJustification: string | null;
  isExtraShift: boolean;
};

type RequestRow = {
  id: string;
  requesterId: string;
  type: string;
  status: string;
  createdAt: string;
};

type CaseRecordRow = {
  id: string;
  assignmentId: string;
  internId: string;
  caseNumber: string;
  nickname: string;
  description: string | null;
  createdAt: string;
};

export type ReportAssignmentCard = {
  assignmentId: string;
  date: string;
  period: string;
  baseCode: string;
  baseName: string;
  baseType: string | null;
  status: string;
  shift: string | null;
  checkinAt: string | null;
  checkoutAt: string | null;
  isJustified: boolean;
  absenceJustification: string | null;
  isExtraShift: boolean;
};

export type ReportTypeSection = {
  key: ReportTypeKey;
  label: string;
  icon: string;
  accentColor: string;
  bgColor: string;
  chipBg: string;
  chipColor: string;
  done: ReportAssignmentCard[];
  scheduled: ReportAssignmentCard[];
};

export type ReportCaseRecordGroup = {
  assignmentId: string;
  assignmentLabel: string;
  records: Array<{
    id: string;
    caseNumber: string;
    nickname: string;
    description: string | null;
    createdAt: string;
  }>;
};

export type ReportRequestItem = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
};

export type ReportInternDocument = {
  internId: string;
  internName: string;
  facultyAbbr: string;
  cohortLabel: string;
  typeSummaryChips: string[];
  statusSummaryChips: string[];
  typeSections: ReportTypeSection[];
  absences: ReportAssignmentCard[];
  progress: {
    targetHours: number;
    completedHours: number;
    targetShifts: number;
    completedShifts: number;
    percentHours: number | null;
    percentShifts: number | null;
    isAboveTarget: boolean;
  };
  metrics: {
    completed: number;
    scheduled: number;
    absences: number;
    pendingRequests: number;
    rejectedRequests: number;
    noCheckinInPeriod: boolean;
  };
  caseRecordGroups: ReportCaseRecordGroup[];
  requests: ReportRequestItem[];
};

export type ReportCoverComparison = {
  cohortKey: string;
  cohortLabel: string;
  internCount: number;
  averageHours: number;
  absenceRate: number;
  metTargetPercent: number;
};

export type ReportHeatmapDay = {
  date: string;
  label: string;
};

export type ReportHeatmapCellState =
  | "done"
  | "scheduled"
  | "absentConfirmed"
  | "noCheckin"
  | "extra";

export type ReportHeatmapRow = {
  internId: string;
  internName: string;
  cohortLabel: string;
  cells: Array<ReportHeatmapCellState[]>;
};

export type ReportDocument = {
  generatedAt: string;
  periodLabel: string;
  scopeLabel: string;
  facultyLabel: string;
  filters: ReportFilterInput;
  warnings: string[];
  previewSummary: {
    internCount: number;
    assignmentCount: number;
  };
  cover: {
    totalHours: number;
    totalCompleted: number;
    totalScheduled: number;
    totalAbsences: number;
    totalCruCompleted: number;
    totalCrlCompleted: number;
    totalUsaCompleted: number;
    belowTargetInterns: Array<{ internId: string; internName: string; percentShifts: number | null }>;
    comparison: ReportCoverComparison[];
    heatmapDays: ReportHeatmapDay[];
    heatmapRows: ReportHeatmapRow[];
  };
  interns: ReportInternDocument[];
};

const TYPE_CONFIG: Record<ReportTypeKey, Omit<ReportTypeSection, "done" | "scheduled">> = {
  CENTRAL: {
    key: "CENTRAL",
    label: "CRU",
    icon: "🏥",
    accentColor: "#1d4ed8",
    bgColor: "#eff6ff",
    chipBg: "#dbeafe",
    chipColor: "#1d4ed8",
  },
  CRL: {
    key: "CRL",
    label: "Intervenção / CRL",
    icon: "🏨",
    accentColor: "#7e22ce",
    bgColor: "#faf5ff",
    chipBg: "#f3e8ff",
    chipColor: "#7e22ce",
  },
  USA: {
    key: "USA",
    label: "USA",
    icon: "🚑",
    accentColor: "#b45309",
    bgColor: "#fffbeb",
    chipBg: "#fef3c7",
    chipColor: "#92400e",
  },
};

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const ROTATION_WINDOW_DAYS = 49; // 7 semanas (faixa operacional 6-8 semanas)

export function getBahiaContext() {
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(now);
  const hourNow = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Bahia", hour: "numeric", hour12: false }).format(now),
    10
  );
  return { todayStr, hourNow };
}

export function classifyReportAssignment(
  assignment: { status: string; date: string; period: string },
  todayStr: string,
  hourNow: number
): ReportAssignmentGroup {
  if (assignment.status === "CHECKED_IN" || assignment.status === "CHECKED_OUT") return "done";
  if (assignment.status === "ABSENT") return "absent";

  if (assignment.status === "SCHEDULED" || assignment.status === "CONFIRMED") {
    let isPast = false;
    if (assignment.period === "NIGHT") {
      const nextDay = new Date(`${assignment.date}T12:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().slice(0, 10);
      if (nextDayStr < todayStr) isPast = true;
      else if (nextDayStr === todayStr) isPast = hourNow >= 7;
    } else {
      isPast = assignment.date < todayStr;
    }
    return isPast ? "absent" : "scheduled";
  }

  return "scheduled";
}

export function classifyHeatmapCell(
  assignment: { status: string; date: string; period: string; isExtraShift: boolean },
  todayStr: string,
  hourNow: number
): ReportHeatmapCellState {
  if (assignment.isExtraShift) return "extra";
  if (assignment.status === "CHECKED_IN" || assignment.status === "CHECKED_OUT") return "done";
  if (assignment.status === "ABSENT") return "absentConfirmed";

  if (assignment.status === "SCHEDULED" || assignment.status === "CONFIRMED") {
    let isPast = false;
    if (assignment.period === "NIGHT") {
      const nextDay = new Date(`${assignment.date}T12:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().slice(0, 10);
      if (nextDayStr < todayStr) isPast = true;
      else if (nextDayStr === todayStr) isPast = hourNow >= 7;
    } else {
      isPast = assignment.date < todayStr;
    }
    return isPast ? "noCheckin" : "scheduled";
  }

  return "scheduled";
}

function toDateOnly(value: Date | string) {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function formatCohort(dateValue: Date, grouping: CohortGrouping) {
  const year = dateValue.getUTCFullYear();
  const month = dateValue.getUTCMonth();
  if (grouping === "SEMESTER") {
    const semester = month < 6 ? 1 : 2;
    return {
      key: `${year}-S${semester}`,
      label: `Turma ${semester}º sem/${year}`,
    };
  }
  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}`,
    label: `Turma ${MONTH_LABELS[month]}/${year}`,
  };
}

function addDays(dateStr: string, amount: number) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function formatShortDate(dateStr: string) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

/**
 * Get rotation transition for a given execution date and faculty.
 * Queries the rotation_transitions table for explicit date boundaries.
 * @param executionDate - Assignment date (YYYY-MM-DD)
 * @param facultyId - Faculty ID to look up transitions
 * @returns Rotation info or null if not found
 */
async function getRotationTransition(executionDate: string, facultyId: string | null) {
  if (!facultyId) return null;

  const result = await db
    .select({
      rotationNumber: rotationTransitions.rotationNumber,
      label: rotationTransitions.label,
      startDate: rotationTransitions.startDate,
      endDate: rotationTransitions.endDate,
    })
    .from(rotationTransitions)
    .where(
      and(
        eq(rotationTransitions.facultyId, facultyId),
        lte(rotationTransitions.startDate, executionDate),
        gte(rotationTransitions.endDate, executionDate)
      )
    )
    .limit(1);

  if (!result.length) return null;

  const row = result[0];
  return {
    key: `rotation-${row.rotationNumber}`,
    label: row.label || `Turma ${row.rotationNumber} (${row.startDate}-${row.endDate})`,
  };
}

/**
 * Build rotation cohort for an assignment.
 * First tries explicit rotation_transitions table (if facultyId provided),
 * then falls back to 49-day window calculation.
 * 
 * FIX: Handles rotation boundary cutoff (e.g., Bruna Bastos missing CRU)
 * @param executionDate - Assignment date (YYYY-MM-DD)
 * @param facultyId - Faculty ID for transition lookup
 * @param fallbackAnchorDate - Anchor date for fallback 49-day window
 */
async function buildRotationCohort(executionDate: string, facultyId: string | null, fallbackAnchorDate: string) {
  // Try explicit rotation transition first
  if (facultyId) {
    const transition = await getRotationTransition(executionDate, facultyId);
    if (transition) {
      return transition;
    }
  }

  // Fallback: 49-day window (for faculties without explicit transitions)
  const executionMs = Date.parse(`${executionDate}T12:00:00Z`);
  const anchorMs = Date.parse(`${fallbackAnchorDate}T12:00:00Z`);
  const dayDiff = Math.floor((executionMs - anchorMs) / (24 * 60 * 60 * 1000));
  const windowIndex = Math.max(0, Math.floor(dayDiff / ROTATION_WINDOW_DAYS));
  const windowStart = addDays(fallbackAnchorDate, windowIndex * ROTATION_WINDOW_DAYS);
  const windowEnd = addDays(windowStart, ROTATION_WINDOW_DAYS - 1);
  return {
    key: `${fallbackAnchorDate}-w${String(windowIndex + 1).padStart(2, "0")}`,
    label: `Turma ${windowIndex + 1} (${formatShortDate(windowStart)}-${formatShortDate(windowEnd)})`,
  };
}

function formatDateLabel(dateStr: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${dateStr}T12:00:00`));
}

function buildScopeLabel(filters: ReportFilterInput, selectedInterns: ReportCatalogIntern[]) {
  if (filters.scopeMode === "SPECIFIC_INTERNS") {
    return filters.selectedInternIds.length === 1
      ? selectedInterns[0]?.internName ?? "interno"
      : `${filters.selectedInternIds.length} internos específicos`;
  }
  if (filters.scopeMode === "COHORT") {
    return filters.selectedCohorts.length > 0 ? filters.selectedCohorts.join(", ") : "turma inteira";
  }
  if (filters.scopeMode === "PERFORMANCE") return "internos filtrados por performance";
  return "todos os internos selecionados";
}

function buildExportScopeSlug(filters: ReportFilterInput) {
  if (filters.scopeMode === "COHORT" && filters.selectedCohorts.length > 0) {
    return filters.selectedCohorts.join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }
  if (filters.scopeMode === "SPECIFIC_INTERNS") return "internos-especificos";
  if (filters.scopeMode === "PERFORMANCE") return "performance";
  return "todos";
}

function getTypeKey(baseType: string | null): ReportTypeKey {
  if (baseType === "CRL") return "CRL";
  if (baseType === "USA") return "USA";
  return "CENTRAL";
}

function sortInterns(interns: ReportInternDocument[], orderBy: ReportOrderBy) {
  const sorted = [...interns];
  sorted.sort((left, right) => {
    if (orderBy === "COHORT_THEN_ALPHABETICAL") {
      if (left.cohortLabel !== right.cohortLabel) return left.cohortLabel.localeCompare(right.cohortLabel);
      return left.internName.localeCompare(right.internName);
    }
    if (orderBy === "META_PERCENT_ASC") {
      return (left.progress.percentShifts ?? 999) - (right.progress.percentShifts ?? 999) || left.internName.localeCompare(right.internName);
    }
    if (orderBy === "ABSENCES_DESC") {
      return right.metrics.absences - left.metrics.absences || left.internName.localeCompare(right.internName);
    }
    if (orderBy === "HOURS_DESC") {
      return right.progress.completedHours - left.progress.completedHours || left.internName.localeCompare(right.internName);
    }
    return left.internName.localeCompare(right.internName);
  });
  return sorted;
}

export type ReportCatalogCohort = {
  id: string;
  name: string | null;
  label: string;
  facultyId: string;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
  startDate: string;
  endDate: string;
};

export async function listReportCatalog(): Promise<{
  faculties: Array<{ id: string; abbr: string; name: string; rotationStartDate: string | null }>;
  cohorts: ReportCatalogCohort[];
  interns: ReportCatalogIntern[];
}> {
  const rows = await db
    .select({
      internId: users.id,
      internName: users.name,
      createdAt: users.createdAt,
      facultyId: faculties.id,
      facultyAbbr: faculties.abbreviation,
      facultyName: faculties.name,
      rotationStartDate: faculties.rotationStartDate,
      targetHours: faculties.targetHours,
      targetShifts: faculties.targetShifts,
      cohortId: userRoles.cohortId,
      cohortName: cohorts.name,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .leftJoin(cohorts, eq(cohorts.id, userRoles.cohortId))
    .where(and(eq(userRoles.role, "INTERN"), eq(userRoles.isActive, true), eq(userRoles.isArchived, false), eq(users.isActive, true)))
    .orderBy(faculties.abbreviation, users.name);

  const internIds = rows.map((row) => row.internId);
  const facultyIds = [...new Set(rows.map((row) => row.facultyId).filter(Boolean))] as string[];

  const firstAssignmentByIntern = new Map<string, string>();
  if (internIds.length > 0) {
    const firstAssignmentRows = await db
      .select({
        internId: assignments.internId,
        firstAssignmentDate: sql<string>`min(${assignments.date})`,
      })
      .from(assignments)
      .where(and(inArray(assignments.internId, internIds), ne(assignments.status, "CANCELLED")))
      .groupBy(assignments.internId);

    for (const row of firstAssignmentRows) {
      if (row.firstAssignmentDate) firstAssignmentByIntern.set(row.internId, row.firstAssignmentDate);
    }
  }

  const firstAssignmentByFaculty = new Map<string, string>();
  if (facultyIds.length > 0) {
    const firstFacultyRows = await db
      .select({
        facultyId: assignments.facultyId,
        firstAssignmentDate: sql<string>`min(${assignments.date})`,
      })
      .from(assignments)
      .where(and(inArray(assignments.facultyId, facultyIds), ne(assignments.status, "CANCELLED")))
      .groupBy(assignments.facultyId);

    for (const row of firstFacultyRows) {
      if (row.firstAssignmentDate) firstAssignmentByFaculty.set(row.facultyId, row.firstAssignmentDate);
    }
  }

  const interns = await Promise.all(
    rows.map(async (row) => {
      const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
      const month = formatCohort(createdAt, "MONTH");
      const semester = formatCohort(createdAt, "SEMESTER");
      const createdAtDate = createdAt.toISOString().slice(0, 10);
      const firstAssignmentDate = firstAssignmentByIntern.get(row.internId) ?? null;
      const executionDate = firstAssignmentDate ?? createdAtDate;
      const anchorDate = row.rotationStartDate
        ?? (row.facultyId ? firstAssignmentByFaculty.get(row.facultyId) : undefined)
        ?? firstAssignmentDate
        ?? createdAtDate;
      const rotation = await buildRotationCohort(executionDate, row.facultyId, anchorDate);
      return {
        internId: row.internId,
        internName: row.internName,
        facultyId: row.facultyId,
        facultyAbbr: row.facultyAbbr,
        facultyName: row.facultyName,
        createdAt: createdAt.toISOString(),
        cohortId: row.cohortId ?? null,
        cohortName: row.cohortName ?? null,
        cohortMonthKey: month.key,
        cohortMonthLabel: month.label,
        cohortSemesterKey: semester.key,
        cohortSemesterLabel: semester.label,
        cohortRotationKey: rotation.key,
        cohortRotationLabel: rotation.label,
        rotationStartDate: row.rotationStartDate,
        firstAssignmentDate,
        targetHours: row.targetHours ?? 0,
        targetShifts: row.targetShifts ?? 0,
      } satisfies ReportCatalogIntern;
    })
  );

  const facultiesMap = new Map<string, { id: string; abbr: string; name: string; rotationStartDate: string | null }>();
  for (const row of rows) {
    if (!row.facultyId || !row.facultyAbbr || !row.facultyName) continue;
    facultiesMap.set(row.facultyId, {
      id: row.facultyId,
      abbr: row.facultyAbbr,
      name: row.facultyName,
      rotationStartDate: row.rotationStartDate,
    });
  }

  const knownFacultyIds = [...facultiesMap.keys()];
  const allCohorts = knownFacultyIds.length > 0
    ? await db
        .select({
          id: cohorts.id,
          name: cohorts.name,
          label: cohorts.label,
          facultyId: cohorts.facultyId,
          status: cohorts.status,
          startDate: cohorts.startDate,
          endDate: cohorts.endDate,
        })
        .from(cohorts)
        .where(inArray(cohorts.facultyId, knownFacultyIds))
        .orderBy(cohorts.facultyId, cohorts.rotationNumber)
    : [];

  return {
    faculties: [...facultiesMap.values()].sort((left, right) => left.abbr.localeCompare(right.abbr)),
    cohorts: allCohorts as ReportCatalogCohort[],
    interns,
  };
}

function getCohortForIntern(intern: ReportCatalogIntern, grouping: CohortGrouping) {
  if (grouping === "NAMED_COHORT") {
    return intern.cohortId
      ? { key: intern.cohortId, label: intern.cohortName ?? "Turma sem nome" }
      : { key: "__sem_turma__", label: "Sem turma atribuída" };
  }
  if (grouping === "ROTATION_7W") {
    return { key: intern.cohortRotationKey, label: intern.cohortRotationLabel };
  }
  if (grouping === "SEMESTER") {
    return { key: intern.cohortRotationKey, label: intern.cohortRotationLabel };
  }
  return { key: intern.cohortMonthKey, label: intern.cohortMonthLabel };
}

function buildInternWarnings(filters: ReportFilterInput) {
  if (filters.cohortGrouping === "NAMED_COHORT") return [];
  return [
    "Turmas inferidas por janela de execução de plantões (7 semanas), ancorada em rotationStartDate quando disponível.",
    "Rodízio ainda não tem entidade completa com data final; a inferência pode divergir em casos de ajustes manuais.",
  ];
}

export async function generateAdminReport(filters: ReportFilterInput): Promise<{
  document: ReportDocument;
  exportBaseName: string;
}> {
  const catalog = await listReportCatalog();
  const facultyFilteredInterns = catalog.interns.filter((intern) => !filters.facultyId || intern.facultyId === filters.facultyId);

  const selectedInternCatalog = facultyFilteredInterns.filter((intern) => {
    const cohort = getCohortForIntern(intern, filters.cohortGrouping);
    if (filters.scopeMode === "SPECIFIC_INTERNS") return filters.selectedInternIds.includes(intern.internId);
    if (filters.scopeMode === "COHORT") return filters.selectedCohorts.length === 0 || filters.selectedCohorts.includes(cohort.key);
    return true;
  });

  const scopedInternIds = selectedInternCatalog.map((intern) => intern.internId);

  if (scopedInternIds.length === 0) {
    const emptyDocument: ReportDocument = {
      generatedAt: new Date().toISOString(),
      periodLabel: `${formatDateLabel(filters.from)} a ${formatDateLabel(filters.to)}`,
      scopeLabel: "nenhum interno encontrado",
      facultyLabel: filters.facultyId ? catalog.faculties.find((faculty) => faculty.id === filters.facultyId)?.abbr ?? "Faculdade" : "Todas",
      filters,
      warnings: buildInternWarnings(filters),
      previewSummary: { internCount: 0, assignmentCount: 0 },
      cover: {
        totalHours: 0,
        totalCompleted: 0,
        totalScheduled: 0,
        totalAbsences: 0,
        totalCruCompleted: 0,
        totalCrlCompleted: 0,
        totalUsaCompleted: 0,
        belowTargetInterns: [],
        comparison: [],
        heatmapDays: [],
        heatmapRows: [],
      },
      interns: [],
    };
    return {
      document: emptyDocument,
      exportBaseName: `relatorio_todas_${buildExportScopeSlug(filters)}_${filters.to}`,
    };
  }

  const assignmentRowsRaw = await db
    .select({
      assignmentId: assignments.id,
      internId: assignments.internId,
      date: assignments.date,
      period: assignments.period,
      baseCode: bases.code,
      baseName: bases.name,
      baseType: bases.type,
      status: assignments.status,
      shift: assignments.shift,
      checkinAt: checkins.checkinAt,
      checkoutAt: checkins.checkoutAt,
      absenceJustification: assignments.absenceJustification,
      isExtraShift: assignments.isExtraShift,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .leftJoin(checkins, eq(checkins.assignmentId, assignments.id))
    .where(
      and(
        inArray(assignments.internId, scopedInternIds),
        gte(assignments.date, filters.from),
        lte(assignments.date, filters.to),
        ne(assignments.status, "CANCELLED")
      )
    )
    .orderBy(assignments.date, assignments.period, bases.code);

  const assignmentRows: AssignmentRow[] = assignmentRowsRaw.map((row) => ({
    assignmentId: row.assignmentId,
    internId: row.internId,
    date: row.date,
    period: row.period,
    baseCode: row.baseCode,
    baseName: row.baseName,
    baseType: row.baseType,
    status: row.status,
    shift: row.shift,
    checkinAt: row.checkinAt ? row.checkinAt.toISOString() : null,
    checkoutAt: row.checkoutAt ? row.checkoutAt.toISOString() : null,
    absenceJustification: row.absenceJustification,
    isExtraShift: row.isExtraShift,
  }));

  const requestRowsRaw = await db
    .select({
      id: requests.id,
      requesterId: requests.requesterId,
      type: requests.type,
      status: requests.status,
      createdAt: requests.createdAt,
    })
    .from(requests)
    .where(
      and(
        inArray(requests.requesterId, scopedInternIds),
        gte(requests.createdAt, new Date(`${filters.from}T00:00:00.000Z`)),
        lte(requests.createdAt, new Date(`${filters.to}T23:59:59.999Z`))
      )
    )
    .orderBy(desc(requests.createdAt));

  const requestRows: RequestRow[] = requestRowsRaw.map((row) => ({
    id: row.id,
    requesterId: row.requesterId,
    type: row.type,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));

  const assignmentIds = assignmentRows.map((row) => row.assignmentId);
  const caseRecordRows: CaseRecordRow[] = assignmentIds.length === 0
    ? []
    : (await db
        .select({
          id: caseRecords.id,
          assignmentId: caseRecords.assignmentId,
          internId: caseRecords.internId,
          caseNumber: caseRecords.caseNumber,
          nickname: caseRecords.nickname,
          description: caseRecords.description,
          createdAt: caseRecords.createdAt,
        })
        .from(caseRecords)
        .where(inArray(caseRecords.assignmentId, assignmentIds))
        .orderBy(desc(caseRecords.createdAt)))
        .map((row) => ({
          id: row.id,
          assignmentId: row.assignmentId,
          internId: row.internId,
          caseNumber: row.caseNumber,
          nickname: row.nickname,
          description: row.description,
          createdAt: row.createdAt.toISOString(),
        }));

  const assignmentsByIntern = new Map<string, AssignmentRow[]>();
  for (const row of assignmentRows) {
    const list = assignmentsByIntern.get(row.internId) ?? [];
    list.push(row);
    assignmentsByIntern.set(row.internId, list);
  }

  const requestsByIntern = new Map<string, RequestRow[]>();
  for (const row of requestRows) {
    const list = requestsByIntern.get(row.requesterId) ?? [];
    list.push(row);
    requestsByIntern.set(row.requesterId, list);
  }

  const caseRecordsByIntern = new Map<string, CaseRecordRow[]>();
  for (const row of caseRecordRows) {
    const list = caseRecordsByIntern.get(row.internId) ?? [];
    list.push(row);
    caseRecordsByIntern.set(row.internId, list);
  }

  const { todayStr, hourNow } = getBahiaContext();
  const filteredInternDocs: ReportInternDocument[] = [];

  for (const intern of facultyFilteredInterns) {
    if (!scopedInternIds.includes(intern.internId)) continue;

    const cohort = getCohortForIntern(intern, filters.cohortGrouping);
    const internAssignments = (assignmentsByIntern.get(intern.internId) ?? []).map((assignment) => ({
      assignmentId: assignment.assignmentId,
      date: assignment.date,
      period: assignment.period,
      baseCode: assignment.baseCode,
      baseName: assignment.baseName,
      baseType: assignment.baseType,
      status: assignment.status,
      shift: assignment.shift,
      checkinAt: assignment.checkinAt,
      checkoutAt: assignment.checkoutAt,
      isJustified: Boolean(assignment.absenceJustification),
      absenceJustification: assignment.absenceJustification,
      isExtraShift: assignment.isExtraShift,
    } satisfies ReportAssignmentCard));

    const typeSections: Record<ReportTypeKey, ReportTypeSection> = {
      CENTRAL: { ...TYPE_CONFIG.CENTRAL, done: [], scheduled: [] },
      CRL: { ...TYPE_CONFIG.CRL, done: [], scheduled: [] },
      USA: { ...TYPE_CONFIG.USA, done: [], scheduled: [] },
    };
    const absences: ReportAssignmentCard[] = [];

    for (const assignment of internAssignments) {
      const group = classifyReportAssignment(assignment, todayStr, hourNow);
      if (group === "absent") {
        absences.push(assignment);
        continue;
      }
      const typeKey = getTypeKey(assignment.baseType);
      typeSections[typeKey][group].push(assignment);
    }

    for (const key of Object.keys(typeSections) as ReportTypeKey[]) {
      typeSections[key].done.sort((left, right) => right.date.localeCompare(left.date));
      typeSections[key].scheduled.sort((left, right) => left.date.localeCompare(right.date));
    }
    absences.sort((left, right) => right.date.localeCompare(left.date));

    const completedCount = Object.values(typeSections).reduce((total, section) => total + section.done.length, 0);
    const scheduledCount = Object.values(typeSections).reduce((total, section) => total + section.scheduled.length, 0);
    const pendingRequestCount = (requestsByIntern.get(intern.internId) ?? []).filter((row) => row.status === "PENDING" || row.status === "ESCALATED").length;
    const rejectedRequestCount = (requestsByIntern.get(intern.internId) ?? []).filter((row) => row.status === "REJECTED").length;
    const completedHours = Object.values(typeSections).reduce((total, section) => total + sumAssignmentHours(section.done), 0);
    const percentHours = intern.targetHours > 0 ? Math.round((completedHours / intern.targetHours) * 100) : null;
    const percentShifts = intern.targetShifts > 0 ? Math.round((completedCount / intern.targetShifts) * 100) : null;
    const noCheckinInPeriod = completedCount === 0;

    if (filters.scopeMode === "PERFORMANCE") {
      const checks: boolean[] = [];
      if (filters.performance.belowHoursTarget) checks.push(completedHours < intern.targetHours);
      if (filters.performance.belowShiftsTarget) checks.push(completedCount < intern.targetShifts);
      if (filters.performance.hasAbsences) checks.push(absences.length > 0);
      if (filters.performance.moreThanNAbsences) checks.push(absences.length > filters.performance.absencesThreshold);
      if (filters.performance.hasPendingRequests) checks.push(pendingRequestCount > 0);
      if (filters.performance.hasRejectedRequests) checks.push(rejectedRequestCount > 0);
      if (filters.performance.aboveTarget) checks.push(completedHours > intern.targetHours && intern.targetHours > 0);
      if (filters.performance.noCheckinInPeriod) checks.push(noCheckinInPeriod);
      if (checks.length > 0 && checks.some((value) => !value)) continue;
    }

    const internCaseGroups = (caseRecordsByIntern.get(intern.internId) ?? []).reduce<Map<string, ReportCaseRecordGroup>>((acc, record) => {
      const assignment = internAssignments.find((item) => item.assignmentId === record.assignmentId);
      const existing = acc.get(record.assignmentId) ?? {
        assignmentId: record.assignmentId,
        assignmentLabel: assignment ? `${formatDateLabel(assignment.date)} · ${assignment.baseCode}` : record.assignmentId,
        records: [],
      };
      existing.records.push({
        id: record.id,
        caseNumber: record.caseNumber,
        nickname: record.nickname,
        description: record.description,
        createdAt: record.createdAt,
      });
      acc.set(record.assignmentId, existing);
      return acc;
    }, new Map());

    const typeSummaryChips = (Object.values(typeSections) as ReportTypeSection[])
      .filter((section) => section.done.length + section.scheduled.length > 0)
      .map((section) => `${section.icon} ${section.label}: ✅${section.done.length}${section.scheduled.length > 0 ? ` 📅${section.scheduled.length}` : ""}`);

    const statusSummaryChips = [
      completedCount > 0 ? `✅ ${completedCount} cumprido${completedCount !== 1 ? "s" : ""}` : "",
      scheduledCount > 0 ? `📅 ${scheduledCount} agendado${scheduledCount !== 1 ? "s" : ""}` : "",
      absences.length > 0 ? `⚠️ ${absences.length} ausência${absences.length !== 1 ? "s" : ""}` : "",
    ].filter(Boolean);

    filteredInternDocs.push({
      internId: intern.internId,
      internName: intern.internName,
      facultyAbbr: intern.facultyAbbr ?? "—",
      cohortLabel: cohort.label,
      typeSummaryChips,
      statusSummaryChips,
      typeSections: Object.values(typeSections),
      absences,
      progress: {
        targetHours: intern.targetHours,
        completedHours,
        targetShifts: intern.targetShifts,
        completedShifts: completedCount,
        percentHours,
        percentShifts,
        isAboveTarget: intern.targetHours > 0 && completedHours > intern.targetHours,
      },
      metrics: {
        completed: completedCount,
        scheduled: scheduledCount,
        absences: absences.length,
        pendingRequests: pendingRequestCount,
        rejectedRequests: rejectedRequestCount,
        noCheckinInPeriod,
      },
      caseRecordGroups: [...internCaseGroups.values()],
      requests: (requestsByIntern.get(intern.internId) ?? []).map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        createdAt: row.createdAt,
      })),
    });
  }

  const interns = sortInterns(filteredInternDocs, filters.orderBy);
  const totalCompleted = interns.reduce((sum, intern) => sum + intern.metrics.completed, 0);
  const totalScheduled = interns.reduce((sum, intern) => sum + intern.metrics.scheduled, 0);
  const totalAbsences = interns.reduce((sum, intern) => sum + intern.metrics.absences, 0);
  const totalHours = interns.reduce((sum, intern) => sum + intern.progress.completedHours, 0);
  const totalCruCompleted = interns.reduce((sum, intern) => sum + (intern.typeSections.find((section) => section.key === "CENTRAL")?.done.length ?? 0), 0);
  const totalCrlCompleted = interns.reduce((sum, intern) => sum + (intern.typeSections.find((section) => section.key === "CRL")?.done.length ?? 0), 0);
  const totalUsaCompleted = interns.reduce((sum, intern) => sum + (intern.typeSections.find((section) => section.key === "USA")?.done.length ?? 0), 0);

  const comparisonMap = new Map<string, ReportCoverComparison>();
  for (const intern of interns) {
    const key = intern.cohortLabel;
    const current = comparisonMap.get(key) ?? {
      cohortKey: key,
      cohortLabel: key,
      internCount: 0,
      averageHours: 0,
      absenceRate: 0,
      metTargetPercent: 0,
    };
    current.internCount += 1;
    current.averageHours += intern.progress.completedHours;
    current.absenceRate += intern.metrics.completed + intern.metrics.scheduled + intern.metrics.absences > 0
      ? intern.metrics.absences / (intern.metrics.completed + intern.metrics.scheduled + intern.metrics.absences)
      : 0;
    current.metTargetPercent += intern.progress.percentShifts !== null && intern.progress.percentShifts >= 100 ? 1 : 0;
    comparisonMap.set(key, current);
  }
  const comparison = [...comparisonMap.values()].map((item) => ({
    ...item,
    averageHours: item.internCount > 0 ? Math.round(item.averageHours / item.internCount) : 0,
    absenceRate: item.internCount > 0 ? Math.round((item.absenceRate / item.internCount) * 100) : 0,
    metTargetPercent: item.internCount > 0 ? Math.round((item.metTargetPercent / item.internCount) * 100) : 0,
  })).sort((left, right) => left.cohortLabel.localeCompare(right.cohortLabel));

  const heatmapDays: ReportHeatmapDay[] = [];
  const cursor = new Date(`${filters.from}T12:00:00`);
  const endDate = new Date(`${filters.to}T12:00:00`);
  while (cursor <= endDate) {
    const dateStr = cursor.toISOString().slice(0, 10);
    heatmapDays.push({ date: dateStr, label: formatDateLabel(dateStr) });
    cursor.setDate(cursor.getDate() + 1);
  }

  const heatmapRowsSource = [...interns].sort((left, right) => {
    if (left.cohortLabel !== right.cohortLabel) return left.cohortLabel.localeCompare(right.cohortLabel);
    return left.internName.localeCompare(right.internName);
  });

  const heatmapRows: ReportHeatmapRow[] = heatmapRowsSource.map((intern) => {
    const byDate = new Map<string, ReportHeatmapCellState[]>();
    const allCards: ReportAssignmentCard[] = [
      ...intern.absences,
      ...intern.typeSections.flatMap((section) => [...section.done, ...section.scheduled]),
    ];
    for (const card of allCards) {
      const state = classifyHeatmapCell(card, todayStr, hourNow);
      const list = byDate.get(card.date) ?? [];
      if (!list.includes(state)) list.push(state);
      byDate.set(card.date, list);
    }
    return {
      internId: intern.internId,
      internName: intern.internName,
      cohortLabel: intern.cohortLabel,
      cells: heatmapDays.map((day) => byDate.get(day.date) ?? []),
    };
  });

  const selectedInterns = facultyFilteredInterns.filter((intern) => interns.some((item) => item.internId === intern.internId));
  const facultyLabel = filters.facultyId
    ? catalog.faculties.find((faculty) => faculty.id === filters.facultyId)?.abbr ?? "Faculdade"
    : "Todas";

  const document: ReportDocument = {
    generatedAt: new Date().toISOString(),
    periodLabel: `${formatDateLabel(filters.from)} a ${formatDateLabel(filters.to)}`,
    scopeLabel: buildScopeLabel(filters, selectedInterns),
    facultyLabel,
    filters,
    warnings: buildInternWarnings(filters),
    previewSummary: {
      internCount: interns.length,
      assignmentCount: assignmentRows.length,
    },
    cover: {
      totalHours,
      totalCompleted,
      totalScheduled,
      totalAbsences,
      totalCruCompleted,
      totalCrlCompleted,
      totalUsaCompleted,
      belowTargetInterns: interns
        .filter((intern) => intern.progress.percentShifts !== null && intern.progress.percentShifts < 100)
        .sort((left, right) => (left.progress.percentShifts ?? 999) - (right.progress.percentShifts ?? 999) || left.internName.localeCompare(right.internName))
        .map((intern) => ({
          internId: intern.internId,
          internName: intern.internName,
          percentShifts: intern.progress.percentShifts,
        })),
      comparison: filters.display.compareCohorts ? comparison : [],
      heatmapDays: filters.display.showHeatmap ? heatmapDays : [],
      heatmapRows: filters.display.showHeatmap ? heatmapRows : [],
    },
    interns,
  };

  return {
    document,
    exportBaseName: `relatorio_${facultyLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}_${buildExportScopeSlug(filters)}_${filters.to}`,
  };
}