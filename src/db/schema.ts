import {
  pgTable, pgEnum, uuid, varchar, text, integer, real,
  boolean, timestamp, date, uniqueIndex, index, jsonb,
} from "drizzle-orm/pg-core";

// ==================== ENUMS ====================

export const roleEnum = pgEnum("role", [
  "COORDINATOR", "LEADER", "PRECEPTOR", "INTERN",
]);

export const shiftPeriodEnum = pgEnum("shift_period", ["DAY", "NIGHT"]);

export const dayOfWeekEnum = pgEnum("day_of_week", [
  "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN",
]);

export const baseTypeEnum = pgEnum("base_type", ["USA", "CENTRAL", "CRL"]);

export const assignmentStatusEnum = pgEnum("assignment_status", [
  "SCHEDULED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "ABSENT", "CANCELLED",
  // EXCUSED: falta abonada pela coordenação. Conta para a meta do interno,
  // mas nunca vira presença sintética — o histórico mostra que foi abono.
  "EXCUSED",
]);

export const checkinStatusEnum = pgEnum("checkin_status", [
  "PENDING", "VALIDATED", "EXPIRED", "REJECTED",
]);

export const checkinMethodEnum = pgEnum("checkin_method", [
  "TELEGRAM_QR", "TELEGRAM_CODE", "APP_DIRECT", "GEO",
]);

export const requestTypeEnum = pgEnum("request_type", [
  "SWAP", "EXTRA_SHIFT", "DROP_SHIFT",
]);

export const requestStatusEnum = pgEnum("request_status", [
  "PENDING", "APPROVED", "REJECTED", "ESCALATED", "COMPLETED", "OPEN", "CANCELLED",
  // AWAITING_AUTH: aposentado em 2026-07-30, quando a autorização do preceptor
  // deu lugar à cota de uma troca de CRU por rodízio. Fica no enum porque
  // remover valor de enum no Postgres exige recriar o tipo, e o histórico de
  // audit_log ainda cita o status.
  "AWAITING_AUTH",
]);

export const photoChangeRequestStatusEnum = pgEnum("photo_change_request_status", [
  "PENDING", "APPROVED", "REJECTED",
]);

// ==================== TABELAS ====================

export const faculties = pgTable("faculties", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  abbreviation: varchar("abbreviation", { length: 10 }).notNull().unique(),
  targetHours: integer("target_hours").notNull().default(0),
  targetShifts: integer("target_shifts").notNull().default(0),
  targetShiftsPerWeek: integer("target_shifts_per_week").notNull().default(0),
  targetUSAsPerWeek: integer("target_usas_per_week").notNull().default(0),
  targetUSAsTotal: integer("target_usas_total").notNull().default(0),
  targetCRUsPerWeek: integer("target_crus_per_week").notNull().default(0),
  targetCRUsTotal: integer("target_crus_total").notNull().default(0),
  targetCRLsPerWeek: integer("target_crls_per_week").notNull().default(0),
  totalInterns: integer("total_interns").notNull().default(0),
  isVirtual: boolean("is_virtual").notNull().default(false),
  rotationStartDate: date("rotation_start_date").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  cpf: varchar("cpf", { length: 14 }).unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  phone: varchar("phone", { length: 20 }),
  passwordHash: text("password_hash").notNull(),
  forcePasswordChange: boolean("force_password_change").notNull().default(false),
  googleId: varchar("google_id", { length: 255 }).unique(),
  selfie: text("selfie"),
  selfieUploadedAt: timestamp("selfie_uploaded_at"),
  registrationCode: varchar("registration_code", { length: 20 }),
  isActive: boolean("is_active").notNull().default(true),
  mergedIntoUserId: uuid("merged_into_user_id"),
  mergedAt: timestamp("merged_at"),
  mergeRollbackExpiresAt: timestamp("merge_rollback_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const bases = pgTable("bases", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 10 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  type: baseTypeEnum("type").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  geoFenceMeters: integer("geo_fence_meters").notNull().default(200),
  isActive: boolean("is_active").notNull().default(true),
});

export const userRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  role: roleEnum("role").notNull(),
  facultyId: uuid("faculty_id").references(() => faculties.id),
  baseId: uuid("base_id").references(() => bases.id),
  cohortId: uuid("cohort_id").references(() => cohorts.id),
  isActive: boolean("is_active").notNull().default(true),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: timestamp("archived_at"),
  archivedBy: uuid("archived_by").references(() => users.id),
}, (t) => [
  uniqueIndex("uq_user_role_faculty").on(t.userId, t.role, t.facultyId),
  index("idx_user_roles_cohort").on(t.cohortId),
]);

export const slotRules = pgTable("slot_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  baseId: uuid("base_id").notNull().references(() => bases.id),
  dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
  period: shiftPeriodEnum("period").notNull(),
  facultyId: uuid("faculty_id").notNull().references(() => faculties.id),
  capacity: integer("capacity").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  isBlocked: boolean("is_blocked").notNull().default(false),
  blockedReason: varchar("blocked_reason", { length: 100 }),
  blockedBy: uuid("blocked_by").references(() => users.id),
  blockedAt: timestamp("blocked_at"),
  isExtraShift: boolean("is_extra_shift").notNull().default(false),
}, (t) => [
  uniqueIndex("uq_slot_rule").on(t.baseId, t.dayOfWeek, t.period, t.facultyId),
]);

export const assignments = pgTable("assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  internId: uuid("intern_id").notNull().references(() => users.id),
  facultyId: uuid("faculty_id").notNull().references(() => faculties.id),
  baseId: uuid("base_id").notNull().references(() => bases.id),
  date: date("date").notNull(),
  period: shiftPeriodEnum("period").notNull(),
  shift: varchar("shift", { length: 10 }),  // 'MORNING' | 'AFTERNOON' | null (EBMSP only)
  status: assignmentStatusEnum("status").notNull().default("SCHEDULED"),
  isExtraShift: boolean("is_extra_shift").notNull().default(false),
  extraShiftNotes: text("extra_shift_notes"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  notes: text("notes"),
  absenceJustification: text("absence_justification"),
  absenceJustificationActor: varchar("absence_justification_actor", { length: 20 }),
  absenceJustificationAt: timestamp("absence_justification_at"),
  // Dismiss do alerta de falta no cockpit /admin. Quando preenchido, a
  // falta não aparece mais no card "Faltas pendentes" mas continua em
  // banco com status='ABSENT' (preserva histórico para relatório).
  absenceAlertDismissedAt: timestamp("absence_alert_dismissed_at"),
  absenceAlertDismissedBy: uuid("absence_alert_dismissed_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // Note: actual unique constraint is in DB as uq_intern_day_period_shift
  // using COALESCE(shift, 'FULL') — Drizzle can't express this directly
  index("idx_assignment_date").on(t.date),
  index("idx_assignment_intern").on(t.internId),
]);

export const checkins = pgTable("checkins", {
  id: uuid("id").primaryKey().defaultRandom(),
  assignmentId: uuid("assignment_id").notNull().references(() => assignments.id).unique(),
  internId: uuid("intern_id").notNull().references(() => users.id),
  checkinLat: real("checkin_lat"),
  checkinLng: real("checkin_lng"),
  geoDistanceMeters: real("geo_distance_meters"),
  geoValid: boolean("geo_valid"),
  checkinAt: timestamp("checkin_at"),
  totpSecret: varchar("totp_secret", { length: 64 }),
  totpValidatedAt: timestamp("totp_validated_at"),
  validatedBy: uuid("validated_by").references(() => users.id),
  validatedByName: varchar("validated_by_name", { length: 255 }),
  method: checkinMethodEnum("method"),
  internObservations: text("intern_observations"),
  preceptorObservations: text("preceptor_observations"),
  status: checkinStatusEnum("status").notNull().default("PENDING"),
  checkoutAt: timestamp("checkout_at"),
  checkoutConfirmedBy: uuid("checkout_confirmed_by").references(() => users.id),
  checkoutConfirmedByName: varchar("checkout_confirmed_by_name", { length: 255 }),
  checkoutNotes: text("checkout_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const requests = pgTable("requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: requestTypeEnum("type").notNull(),
  requesterId: uuid("requester_id").notNull().references(() => users.id),
  assignmentId: uuid("assignment_id").references(() => assignments.id),
  targetInternId: uuid("target_intern_id").references(() => users.id),
  targetAssignmentId: uuid("target_assignment_id").references(() => assignments.id),
  extraBaseId: uuid("extra_base_id").references(() => bases.id),
  extraDate: date("extra_date"),
  extraPeriod: shiftPeriodEnum("extra_period"),
  status: requestStatusEnum("status").notNull().default("PENDING"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const caseRecords = pgTable("case_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  assignmentId: uuid("assignment_id").notNull().references(() => assignments.id),
  internId: uuid("intern_id").notNull().references(() => users.id),
  caseNumber: varchar("case_number", { length: 4 }).notNull(),
  nickname: varchar("nickname", { length: 100 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const qrSessions = pgTable("qr_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  checkinId: uuid("checkin_id").notNull().references(() => checkins.id),
  internId: uuid("intern_id").notNull().references(() => users.id),
  totpSecret: varchar("totp_secret", { length: 64 }).notNull(),
  activeCode: varchar("active_code", { length: 6 }).notNull(),
  codeExpiresAt: timestamp("code_expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  consumedBy: uuid("consumed_by").references(() => users.id),
}, (t) => [
  index("idx_qr_active_code").on(t.activeCode),
]);

export const telegramBindings = pgTable("telegram_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  telegramUserId: varchar("telegram_user_id", { length: 50 }).notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id).unique(),
  telegramName: varchar("telegram_name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(),
  entity: varchar("entity", { length: 50 }),
  entityId: uuid("entity_id"),
  payload: jsonb("payload"),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_audit_created").on(t.createdAt),
  index("idx_audit_user").on(t.userId),
]);

export const userMergeEvents = pgTable("user_merge_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceUserId: uuid("source_user_id").notNull().references(() => users.id),
  sourceName: varchar("source_name", { length: 255 }).notNull(),
  sourceEmail: varchar("source_email", { length: 255 }).notNull(),
  targetUserId: uuid("target_user_id").notNull().references(() => users.id),
  targetName: varchar("target_name", { length: 255 }).notNull(),
  targetEmail: varchar("target_email", { length: 255 }).notNull(),
  performedByUserId: uuid("performed_by_user_id").notNull().references(() => users.id),
  sourceUserSnapshot: jsonb("source_user_snapshot").notNull(),
  sourceRolesSnapshot: jsonb("source_roles_snapshot").notNull(),
  sourceBindingSnapshot: jsonb("source_binding_snapshot"),
  movedRecords: jsonb("moved_records").notNull(),
  insertedTargetRoleIds: jsonb("inserted_target_role_ids").notNull(),
  rollbackAvailableUntil: timestamp("rollback_available_until").notNull(),
  rolledBackAt: timestamp("rolled_back_at"),
  rolledBackByUserId: uuid("rolled_back_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_user_merge_events_source").on(t.sourceUserId),
  index("idx_user_merge_events_target").on(t.targetUserId),
  index("idx_user_merge_events_available_until").on(t.rollbackAvailableUntil),
]);

export const userPhotoChangeRequests = pgTable("user_photo_change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  facultyId: uuid("faculty_id").references(() => faculties.id),
  currentSelfie: text("current_selfie"),
  requestedSelfie: text("requested_selfie").notNull(),
  status: photoChangeRequestStatusEnum("status").notNull().default("PENDING"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_photo_change_user_status").on(t.userId, t.status),
  index("idx_photo_change_faculty_status").on(t.facultyId, t.status),
  index("idx_photo_change_requested_at").on(t.requestedAt),
]);

export const inviteLinks = pgTable("invite_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  type: varchar("type", { length: 20 }).notNull().default("INTERN_REGISTER"),
  targetRole: varchar("target_role", { length: 20 }).notNull().default("INTERN"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  facultyId: uuid("faculty_id").references(() => faculties.id),
  baseId: uuid("base_id").references(() => bases.id),
  cohortId: uuid("cohort_id").references(() => cohorts.id),
  targetUserId: uuid("target_user_id").references(() => users.id),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").notNull().default(true),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  token: varchar("token", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_prt_token").on(t.token),
]);

// CRU fixed weekly assignments — auto-repeating template
export const cruFixedAssignments = pgTable("cru_fixed_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  internId: uuid("intern_id").notNull().references(() => users.id),
  facultyId: uuid("faculty_id").notNull().references(() => faculties.id),
  dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
  period: shiftPeriodEnum("period").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  // Vigência do rodízio. validFrom existe para a cota de troca de CRU saber
  // quais trocas contam no rodízio corrente do interno.
  validFrom: date("valid_from").notNull(),
  validUntil: date("valid_until").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_cru_fixed").on(t.internId, t.dayOfWeek, t.period),
  index("idx_cru_fixed_faculty").on(t.facultyId),
]);

// Extra shift offers — public board for first-come-first-served claiming
// Published by COORDINATOR/LEADER; claimed by INTERN/LEADER
export const extraShiftOffers = pgTable("extra_shift_offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  baseId: uuid("base_id").notNull().references(() => bases.id),
  date: date("date").notNull(),
  period: shiftPeriodEnum("period").notNull(),
  shift: varchar("shift", { length: 15 }),
  facultyId: uuid("faculty_id").references(() => faculties.id),
  notes: text("notes"),
  publishedBy: uuid("published_by").notNull().references(() => users.id),
  publishedAt: timestamp("published_at").defaultNow().notNull(),
  claimedBy: uuid("claimed_by").references(() => users.id),
  claimedAt: timestamp("claimed_at"),
  assignmentId: uuid("assignment_id").references(() => assignments.id),
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
}, (t) => [
  index("idx_extra_offer_date").on(t.date),
  index("idx_extra_offer_base").on(t.baseId),
  index("idx_extra_offer_claimed_by").on(t.claimedBy),
]);

// ==================== COHORTS ====================

export const cohortStatusEnum = pgEnum("cohort_status", [
  "PLANNED",
  "ACTIVE",
  "CLOSED",
]);

export const cohorts = pgTable("cohorts", {
  id: uuid("id").primaryKey().defaultRandom(),
  facultyId: uuid("faculty_id").notNull().references(() => faculties.id),
  rotationNumber: integer("rotation_number").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  name: varchar("name", { length: 100 }),  // apelido curto definido pelo coordenador, único por faculty
  label: varchar("label", { length: 255 }).notNull(),
  status: cohortStatusEnum("status").notNull().default("PLANNED"),
  closedAt: timestamp("closed_at"),
  closedBy: uuid("closed_by").references(() => users.id),
  closingReportSnapshot: jsonb("closing_report_snapshot"),
  closingReportHtml: text("closing_report_html"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_cohort_faculty_rotation").on(t.facultyId, t.rotationNumber),
  uniqueIndex("uq_cohort_faculty_name").on(t.facultyId, t.name),
  index("idx_cohort_faculty_status").on(t.facultyId, t.status),
  index("idx_cohort_dates").on(t.startDate, t.endDate),
]);

// Rotation transitions — explicit start/end dates per faculty
// Fixes: rotation boundary cutoff (e.g., Bruna Bastos missing CRU)
export const rotationTransitions = pgTable("rotation_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  facultyId: uuid("faculty_id").notNull().references(() => faculties.id),
  rotationNumber: integer("rotation_number").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  label: varchar("label", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_rotation_per_faculty").on(t.facultyId, t.rotationNumber),
  index("idx_rotation_faculty").on(t.facultyId),
]);

// ── Indisponibilidade declarada pelo interno ──────────────────────────────────
// Exclusiva da instância Vitalmed (feature "internUnavailability", ver
// src/lib/instance.ts). O interno avisa em quais turnos da semana não pode
// pegar plantão, e o sorteio trata isso como bloqueio — não como preferência.
//
// O que o interno declara hoje é só LIVRE: dois turnos, pelo motivo que for.
// CRU_SAMU, USA_SAMU e AULA saíram do formulário porque o sistema passou a
// deduzir os três — os plantões no SAMU vêm do banco de lá
// (samu-schedule-repository.ts) e o dia de aula da faculdade sai de
// DIA_DE_AULA_POR_FACULDADE. Continuam no enum para que linhas gravadas antes
// dessa mudança sigam legíveis. Ver unavailability-policy.ts.
export const unavailabilityReasonEnum = pgEnum("unavailability_reason", [
  "CRU_SAMU", "USA_SAMU", "AULA", "LIVRE",
]);

export const internUnavailability = pgTable("intern_unavailability", {
  id: uuid("id").primaryKey().defaultRandom(),
  internId: uuid("intern_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  period: shiftPeriodEnum("period").notNull(),
  reason: unavailabilityReasonEnum("reason").notNull(),
  notes: text("notes"),
  // Quem registrou: o próprio interno, ou um admin corrigindo por ele.
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  // Um interno não pode ter dois motivos para o mesmo turno.
  uniqueIndex("uq_unavailability_intern_slot").on(t.internId, t.date, t.period),
  index("idx_unavailability_intern_date").on(t.internId, t.date),
  index("idx_unavailability_date").on(t.date),
]);
