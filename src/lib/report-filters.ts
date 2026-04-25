import { z } from "zod";

export const reportScopeModeSchema = z.enum([
  "COHORT",
  "SPECIFIC_INTERNS",
  "PERFORMANCE",
  "ALL_FACULTY",
]);

export const reportOrderBySchema = z.enum([
  "ALPHABETICAL",
  "COHORT_THEN_ALPHABETICAL",
  "META_PERCENT_ASC",
  "ABSENCES_DESC",
  "HOURS_DESC",
]);

export const cohortGroupingSchema = z.enum(["ROTATION_7W", "MONTH", "SEMESTER"]);

export const reportContentSchema = z.object({
  summary: z.boolean(),
  completed: z.boolean(),
  scheduled: z.boolean(),
  absences: z.boolean(),
  caseRecords: z.boolean(),
  requestHistory: z.boolean(),
  progress: z.boolean(),
});

export const reportPerformanceFiltersSchema = z.object({
  belowHoursTarget: z.boolean(),
  belowShiftsTarget: z.boolean(),
  hasAbsences: z.boolean(),
  moreThanNAbsences: z.boolean(),
  absencesThreshold: z.number().int().min(1).max(30),
  hasPendingRequests: z.boolean(),
  hasRejectedRequests: z.boolean(),
  aboveTarget: z.boolean(),
  noCheckinInPeriod: z.boolean(),
});

export const reportDisplayOptionsSchema = z.object({
  compactCompleted: z.boolean(),
  hideEmptySections: z.boolean(),
  includeCover: z.boolean(),
  compareCohorts: z.boolean(),
  showHeatmap: z.boolean(),
});

export const reportFilterInputSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  facultyId: z.string().uuid().nullable(),
  scopeMode: reportScopeModeSchema,
  cohortGrouping: cohortGroupingSchema,
  selectedCohorts: z.array(z.string()).default([]),
  selectedInternIds: z.array(z.string().uuid()).default([]),
  performance: reportPerformanceFiltersSchema,
  content: reportContentSchema,
  orderBy: reportOrderBySchema,
  display: reportDisplayOptionsSchema,
});

export const reportFormatSchema = z.enum(["json", "html", "pdf"]);

export const reportGenerateRequestSchema = z.object({
  format: reportFormatSchema.default("json"),
  filters: reportFilterInputSchema,
});

export type ReportScopeMode = z.infer<typeof reportScopeModeSchema>;
export type ReportOrderBy = z.infer<typeof reportOrderBySchema>;
export type CohortGrouping = z.infer<typeof cohortGroupingSchema>;
export type ReportContent = z.infer<typeof reportContentSchema>;
export type ReportPerformanceFilters = z.infer<typeof reportPerformanceFiltersSchema>;
export type ReportDisplayOptions = z.infer<typeof reportDisplayOptionsSchema>;
export type ReportFilterInput = z.infer<typeof reportFilterInputSchema>;
export type ReportGenerateRequest = z.infer<typeof reportGenerateRequestSchema>;

export const DEFAULT_REPORT_FILTERS: ReportFilterInput = {
  from: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().slice(0, 10),
  to: new Date().toISOString().slice(0, 10),
  facultyId: null,
  scopeMode: "ALL_FACULTY",
  cohortGrouping: "ROTATION_7W",
  selectedCohorts: [],
  selectedInternIds: [],
  performance: {
    belowHoursTarget: false,
    belowShiftsTarget: false,
    hasAbsences: false,
    moreThanNAbsences: false,
    absencesThreshold: 2,
    hasPendingRequests: false,
    hasRejectedRequests: false,
    aboveTarget: false,
    noCheckinInPeriod: false,
  },
  content: {
    summary: true,
    completed: true,
    scheduled: true,
    absences: true,
    caseRecords: true,
    requestHistory: true,
    progress: true,
  },
  orderBy: "ALPHABETICAL",
  display: {
    compactCompleted: false,
    hideEmptySections: true,
    includeCover: true,
    compareCohorts: false,
    showHeatmap: true,
  },
};