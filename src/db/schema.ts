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

export const baseTypeEnum = pgEnum("base_type", ["USA", "CENTRAL"]);

export const assignmentStatusEnum = pgEnum("assignment_status", [
  "SCHEDULED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "ABSENT", "CANCELLED",
]);

export const checkinStatusEnum = pgEnum("checkin_status", [
  "PENDING", "VALIDATED", "EXPIRED", "REJECTED",
]);

export const checkinMethodEnum = pgEnum("checkin_method", [
  "TELEGRAM_QR", "TELEGRAM_CODE", "APP_DIRECT",
]);

export const requestTypeEnum = pgEnum("request_type", [
  "SWAP", "EXTRA_SHIFT", "DROP_SHIFT",
]);

export const requestStatusEnum = pgEnum("request_status", [
  "PENDING", "APPROVED", "REJECTED", "ESCALATED", "COMPLETED",
]);

// ==================== TABELAS ====================

export const faculties = pgTable("faculties", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  abbreviation: varchar("abbreviation", { length: 10 }).notNull().unique(),
  targetHours: integer("target_hours").notNull().default(0),
  targetShifts: integer("target_shifts").notNull().default(0),
  targetShiftsPerWeek: integer("target_shifts_per_week").notNull().default(0),
  totalInterns: integer("total_interns").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  cpf: varchar("cpf", { length: 14 }).unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  phone: varchar("phone", { length: 20 }),
  passwordHash: text("password_hash").notNull(),
  googleId: varchar("google_id", { length: 255 }).unique(),
  selfie: text("selfie"),
  selfieUploadedAt: timestamp("selfie_uploaded_at"),
  registrationCode: varchar("registration_code", { length: 20 }),
  isActive: boolean("is_active").notNull().default(true),
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
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [
  uniqueIndex("uq_user_role_faculty").on(t.userId, t.role, t.facultyId),
]);

export const slotRules = pgTable("slot_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  baseId: uuid("base_id").notNull().references(() => bases.id),
  dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
  period: shiftPeriodEnum("period").notNull(),
  facultyId: uuid("faculty_id").notNull().references(() => faculties.id),
  capacity: integer("capacity").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
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
  status: assignmentStatusEnum("status").notNull().default("SCHEDULED"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_intern_day_period").on(t.internId, t.date, t.period),
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
  method: checkinMethodEnum("method"),
  status: checkinStatusEnum("status").notNull().default("PENDING"),
  checkoutAt: timestamp("checkout_at"),
  checkoutConfirmedBy: uuid("checkout_confirmed_by").references(() => users.id),
  checkoutNotes: text("checkout_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const requests = pgTable("requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: requestTypeEnum("type").notNull(),
  requesterId: uuid("requester_id").notNull().references(() => users.id),
  assignmentId: uuid("assignment_id").notNull().references(() => assignments.id),
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

export const inviteLinks = pgTable("invite_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  type: varchar("type", { length: 20 }).notNull().default("INTERN_REGISTER"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  facultyId: uuid("faculty_id").references(() => faculties.id),
  targetUserId: uuid("target_user_id").references(() => users.id),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").notNull().default(true),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
