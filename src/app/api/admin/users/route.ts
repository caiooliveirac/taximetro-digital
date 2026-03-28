import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { users, userRoles, faculties, bases, assignments, checkins, requests, caseRecords, qrSessions, telegramBindings, auditLog, inviteLinks, passwordResetTokens, cruFixedAssignments, userMergeEvents } from "@/db/schema";
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import { hash } from "bcryptjs";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";
import { alias } from "drizzle-orm/pg-core";

const MERGE_ROLLBACK_WINDOW_DAYS = 7;

const createUserSchema = z.object({
  name: z.string().min(2).max(255),
  cpf: z.string().regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/),
  email: z.string().email(),
  phone: z.string().max(20).optional(),
  password: z.string().min(6),
  registrationCode: z.string().max(20).optional(),
  role: z.enum(["COORDINATOR", "LEADER", "PRECEPTOR", "INTERN"]),
  facultyId: z.string().uuid().optional(),
  baseId: z.string().uuid().optional(),
  alsoPreceptor: z.boolean().optional(),
});

const updateUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(255).optional(),
  cpf: z.string().regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/).nullable().optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).nullable().optional(),
  registrationCode: z.string().max(20).nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
  forcePasswordChange: z.boolean().optional(),
  role: z.enum(["COORDINATOR", "LEADER", "PRECEPTOR", "INTERN"]).optional(),
  facultyId: z.string().uuid().nullable().optional(),
  baseId: z.string().uuid().nullable().optional(),
  alsoPreceptor: z.boolean().optional(),
});

const mergeUsersSchema = z.object({
  sourceUserId: z.string().uuid(),
  targetUserId: z.string().uuid(),
}).refine((data) => data.sourceUserId !== data.targetUserId, {
  message: "Escolha usuários diferentes para mesclar",
  path: ["targetUserId"],
});

async function requireCoordinator(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || token.role !== "COORDINATOR") return null;
  return token;
}

function normalizeRoleScope(role: "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN", facultyId?: string | null, baseId?: string | null) {
  if (role === "INTERN" || role === "LEADER") {
    return { facultyId: facultyId ?? null, baseId: null };
  }

  if (role === "PRECEPTOR") {
    return { facultyId: null, baseId: null };
  }

  return { facultyId: null, baseId: null };
}

const ROLE_PRIORITY: Record<string, number> = {
  COORDINATOR: 0,
  LEADER: 1,
  PRECEPTOR: 2,
  INTERN: 3,
};

type UserRoleRow = {
  id: string;
  name: string;
  cpf: string | null;
  email: string;
  phone: string | null;
  registrationCode: string | null;
  isActive: boolean;
  selfie: string | null;
  createdAt: Date;
  role: string | null;
  facultyId: string | null;
  facultyAbbr: string | null;
  baseId: string | null;
  baseCode: string | null;
  mergedIntoUserId: string | null;
};

type SourceUserSnapshot = {
  name: string;
  cpf: string | null;
  email: string;
  phone: string | null;
  passwordHash: string;
  forcePasswordChange: boolean;
  googleId: string | null;
  selfie: string | null;
  selfieUploadedAt: string | null;
  registrationCode: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type SourceRoleSnapshot = {
  id: string;
  role: "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN";
  facultyId: string | null;
  baseId: string | null;
  isActive: boolean;
};

type SourceBindingSnapshot = {
  id: string;
  telegramUserId: string;
  telegramName: string;
  createdAt: string;
};

type AssignmentRow = typeof assignments.$inferSelect;

type DeletedAssignmentSnapshot = {
  id: string;
  internId: string;
  facultyId: string;
  baseId: string;
  date: string;
  period: AssignmentRow["period"];
  status: AssignmentRow["status"];
  createdBy: string;
  notes: string | null;
  absenceJustification: string | null;
  absenceJustificationActor: string | null;
  absenceJustificationAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AssignmentConflictRow = {
  sourceId: string;
  date: string;
  period: AssignmentRow["period"];
  sourceStatus: AssignmentRow["status"];
  targetId: string;
  targetStatus: AssignmentRow["status"];
};

type MergeMovedRecords = {
  assignmentsInternIds: string[];
  assignmentsCreatedByIds: string[];
  checkinsInternIds: string[];
  checkinsValidatedByIds: string[];
  checkinsCheckoutConfirmedByIds: string[];
  requestsRequesterIds: string[];
  requestsTargetInternIds: string[];
  requestsReviewedByIds: string[];
  caseRecordsInternIds: string[];
  qrSessionsInternIds: string[];
  qrSessionsConsumedByIds: string[];
  auditLogUserIds: string[];
  inviteLinksCreatedByIds: string[];
  inviteLinksTargetUserIds: string[];
  passwordResetTokenIds: string[];
  cruFixedInternIds: string[];
  cruFixedCreatedByIds: string[];
  deletedAssignments: DeletedAssignmentSnapshot[];
  telegramBinding: {
    mode: "none" | "reassigned" | "deleted";
    bindingId: string | null;
  };
};

function serializeDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function serializeAssignmentSnapshot(assignment: AssignmentRow): DeletedAssignmentSnapshot {
  return {
    id: assignment.id,
    internId: assignment.internId,
    facultyId: assignment.facultyId,
    baseId: assignment.baseId,
    date: assignment.date,
    period: assignment.period,
    status: assignment.status,
    createdBy: assignment.createdBy,
    notes: assignment.notes,
    absenceJustification: assignment.absenceJustification,
    absenceJustificationActor: assignment.absenceJustificationActor,
    absenceJustificationAt: serializeDate(assignment.absenceJustificationAt),
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

function formatAssignmentPeriod(period: AssignmentRow["period"]) {
  return period === "DAY" ? "diurno" : "noturno";
}

function buildMergedPlaceholderEmail(userId: string) {
  return `merged+${userId}@rollback.local`;
}

function aggregateUsers(rows: UserRoleRow[]) {
  const grouped = new Map<string, UserRoleRow & { alsoPreceptor: boolean }>();

  for (const row of rows) {
    const current = grouped.get(row.id);
    if (!current) {
      grouped.set(row.id, {
        ...row,
        alsoPreceptor: row.role === "PRECEPTOR",
      });
      continue;
    }

    const currentRank = ROLE_PRIORITY[current.role ?? "INTERN"] ?? 99;
    const nextRank = ROLE_PRIORITY[row.role ?? "INTERN"] ?? 99;
    if (nextRank < currentRank) {
      grouped.set(row.id, {
        ...row,
        alsoPreceptor: current.alsoPreceptor || row.role === "PRECEPTOR",
      });
      continue;
    }

    current.alsoPreceptor = current.alsoPreceptor || row.role === "PRECEPTOR";
  }

  return Array.from(grouped.values()).map((row) => ({
    ...row,
    alsoPreceptor: row.alsoPreceptor && row.role !== "PRECEPTOR",
  }));
}

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || !["COORDINATOR", "LEADER"].includes(token.role as string)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const includeSelfie = req.nextUrl.searchParams.get("includeSelfie") === "1";
  const impersonateRole = req.nextUrl.searchParams.get("impersonateRole");
  const selectedId = req.nextUrl.searchParams.get("id");

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      cpf: users.cpf,
      email: users.email,
      phone: users.phone,
      registrationCode: users.registrationCode,
      isActive: users.isActive,
      selfie: includeSelfie ? users.selfie : sql<string | null>`null`,
      createdAt: users.createdAt,
      role: userRoles.role,
      facultyId: userRoles.facultyId,
      facultyAbbr: faculties.abbreviation,
      baseId: userRoles.baseId,
      baseCode: bases.code,
      mergedIntoUserId: users.mergedIntoUserId,
    })
    .from(users)
    .leftJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.isActive, true)))
    .leftJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .leftJoin(bases, eq(bases.id, userRoles.baseId))
    .orderBy(users.name);

  if (impersonateRole && ["LEADER", "PRECEPTOR", "INTERN"].includes(impersonateRole)) {
    const filteredRoleRows = rows
      .filter((row) => row.isActive)
      .filter((row) => row.role === impersonateRole)
      .filter((row) => !selectedId || row.id === selectedId);

    return NextResponse.json({ success: true, data: filteredRoleRows });
  }

  const aggregated = aggregateUsers(rows as UserRoleRow[]);
  const visibleUsers = aggregated.filter((row) => row.mergedIntoUserId === null);

  // Leader can only see their faculty's users
  const filtered = token.role === "LEADER"
    ? visibleUsers.filter((row) => row.facultyId === token.facultyId)
    : visibleUsers;

  return NextResponse.json({ success: true, data: selectedId ? filtered.filter((row) => row.id === selectedId) : filtered });
}

export async function POST(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const body = await req.json();
  if (typeof body?.email === "string") body.email = body.email.trim().toLowerCase();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const { password, role, facultyId, baseId, alsoPreceptor, ...userData } = parsed.data;
  const shouldAlsoBePreceptor = role === "COORDINATOR" ? true : Boolean(alsoPreceptor && role !== "PRECEPTOR");
  const normalizedScope = normalizeRoleScope(role, facultyId, baseId);

  if ((role === "INTERN" || role === "LEADER") && !normalizedScope.facultyId) {
    return NextResponse.json({ success: false, error: "Faculdade obrigatória para este papel" }, { status: 400 });
  }

  const [existingEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, userData.email)).limit(1);
  if (existingEmail) return NextResponse.json({ success: false, error: "Este email já está em uso por outro usuário" }, { status: 409 });

  const passwordHash = await hash(password, 12);

  const [user] = await db.insert(users).values({ ...userData, passwordHash }).returning();

  await db.insert(userRoles).values({
    userId: user.id,
    role,
    facultyId: normalizedScope.facultyId,
    baseId: normalizedScope.baseId,
  });

  if (shouldAlsoBePreceptor) {
    await db.insert(userRoles).values({
      userId: user.id,
      role: "PRECEPTOR",
      facultyId: null,
      baseId: null,
    });
  }

  await logAudit({ userId: token.id as string, action: "CREATE_USER", entity: "user", entityId: user.id, payload: { role, facultyId: normalizedScope.facultyId, baseId: normalizedScope.baseId, alsoPreceptor: shouldAlsoBePreceptor } });
  return NextResponse.json({ success: true, data: { ...user, role, facultyId: normalizedScope.facultyId, baseId: normalizedScope.baseId, alsoPreceptor: shouldAlsoBePreceptor } }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  try {
    const body = await req.json();
    if (typeof body?.email === "string") body.email = body.email.trim().toLowerCase();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

    const { id, password, forcePasswordChange, role, facultyId, baseId, alsoPreceptor, ...userData } = parsed.data;

    if (userData.email) {
      const [existingEmail] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, userData.email), ne(users.id, id)))
        .limit(1);
      if (existingEmail) {
        return NextResponse.json({ success: false, error: "Este email já está em uso por outro usuário" }, { status: 409 });
      }
    }

    const updateData: Record<string, unknown> = { ...userData, updatedAt: new Date() };
    if (password) updateData.passwordHash = await hash(password, 12);
    if (forcePasswordChange !== undefined) updateData.forcePasswordChange = forcePasswordChange;

    const [updated] = await db.update(users).set(updateData).where(eq(users.id, id)).returning();
    if (!updated) return NextResponse.json({ success: false, error: "Usuário não encontrado" }, { status: 404 });

    if (role !== undefined) {
      const shouldAlsoBePreceptor = role === "COORDINATOR" ? true : Boolean(alsoPreceptor && role !== "PRECEPTOR");
      const normalizedScope = normalizeRoleScope(role, facultyId, baseId);
      if ((role === "INTERN" || role === "LEADER") && !normalizedScope.facultyId) {
        return NextResponse.json({ success: false, error: "Faculdade obrigatória para este papel" }, { status: 400 });
      }

      await db.delete(userRoles).where(eq(userRoles.userId, id));
      await db.insert(userRoles).values({
        userId: id,
        role,
        facultyId: normalizedScope.facultyId,
        baseId: normalizedScope.baseId,
      });

      if (shouldAlsoBePreceptor) {
        await db.insert(userRoles).values({
          userId: id,
          role: "PRECEPTOR",
          facultyId: null,
          baseId: null,
        });
      }
    }

    const normalizedScope = role !== undefined ? normalizeRoleScope(role, facultyId, baseId) : { facultyId, baseId };
    await logAudit({ userId: token.id as string, action: "UPDATE_USER", entity: "user", entityId: id, payload: { role, facultyId: normalizedScope.facultyId ?? null, baseId: normalizedScope.baseId ?? null, email: userData.email ?? null, passwordChanged: Boolean(password), forcePasswordChange: forcePasswordChange ?? null, alsoPreceptor: role ? (role === "COORDINATOR" ? true : Boolean(alsoPreceptor && role !== "PRECEPTOR")) : Boolean(alsoPreceptor) } });
    return NextResponse.json({ success: true, data: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  try {
    const body = await req.json();
    const parsed = mergeUsersSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

    const { sourceUserId, targetUserId } = parsed.data;
    if (sourceUserId === token.id) {
      return NextResponse.json({ success: false, error: "Você não pode mesclar o seu próprio cadastro fonte" }, { status: 409 });
    }

    const [sourceUser] = await db.select().from(users).where(eq(users.id, sourceUserId)).limit(1);
    const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);

    if (!sourceUser || !targetUser) {
      return NextResponse.json({ success: false, error: "Um dos usuários selecionados não foi encontrado" }, { status: 404 });
    }

    if (sourceUser.mergedIntoUserId) {
      return NextResponse.json({ success: false, error: "O cadastro fonte já foi mesclado anteriormente" }, { status: 409 });
    }

    if (targetUser.mergedIntoUserId) {
      return NextResponse.json({ success: false, error: "O cadastro de destino está marcado como mesclado e não pode receber vínculos" }, { status: 409 });
    }

    const targetAssignment = alias(assignments, "target_assignment");
    const assignmentConflicts = await db
      .select({
        sourceId: assignments.id,
        date: assignments.date,
        period: assignments.period,
        sourceStatus: assignments.status,
        targetId: targetAssignment.id,
        targetStatus: targetAssignment.status,
      })
      .from(assignments)
      .innerJoin(targetAssignment, and(
        eq(targetAssignment.internId, targetUserId),
        eq(targetAssignment.date, assignments.date),
        eq(targetAssignment.period, assignments.period),
      ))
      .where(eq(assignments.internId, sourceUserId));

    const discardedAssignmentConflictMap = new Map<string, Pick<AssignmentConflictRow, "date" | "period">>();
    let blockingAssignmentConflict: Pick<AssignmentConflictRow, "date" | "period"> | null = null;

    for (const conflict of assignmentConflicts) {
      if (conflict.sourceStatus === "CANCELLED") {
        discardedAssignmentConflictMap.set(conflict.sourceId, { date: conflict.date, period: conflict.period });
        continue;
      }

      if (conflict.targetStatus === "CANCELLED") {
        discardedAssignmentConflictMap.set(conflict.targetId, { date: conflict.date, period: conflict.period });
        continue;
      }

      blockingAssignmentConflict = { date: conflict.date, period: conflict.period };
      break;
    }

    if (blockingAssignmentConflict) {
      return NextResponse.json({ success: false, error: `Conflito de plantão em ${blockingAssignmentConflict.date} (${formatAssignmentPeriod(blockingAssignmentConflict.period)})` }, { status: 409 });
    }

    const discardedAssignmentIds = Array.from(discardedAssignmentConflictMap.keys());
    let discardedAssignmentRows: AssignmentRow[] = [];

    if (discardedAssignmentIds.length > 0) {
      discardedAssignmentRows = await db.select().from(assignments).where(inArray(assignments.id, discardedAssignmentIds));

      if (discardedAssignmentRows.length !== discardedAssignmentIds.length) {
        return NextResponse.json({ success: false, error: "Os plantões em conflito foram alterados. Atualize a lista e tente novamente." }, { status: 409 });
      }

      const [linkedCheckins, linkedCaseRecords, linkedRequests, linkedTargetRequests] = await Promise.all([
        db.select({ assignmentId: checkins.assignmentId }).from(checkins).where(inArray(checkins.assignmentId, discardedAssignmentIds)),
        db.select({ assignmentId: caseRecords.assignmentId }).from(caseRecords).where(inArray(caseRecords.assignmentId, discardedAssignmentIds)),
        db.select({ assignmentId: requests.assignmentId }).from(requests).where(inArray(requests.assignmentId, discardedAssignmentIds)),
        db.select({ assignmentId: requests.targetAssignmentId }).from(requests).where(inArray(requests.targetAssignmentId, discardedAssignmentIds)),
      ]);

      const blockedDiscardedAssignmentIds = new Set<string>([
        ...linkedCheckins.map((row) => row.assignmentId),
        ...linkedCaseRecords.map((row) => row.assignmentId),
        ...linkedRequests.map((row) => row.assignmentId).filter((assignmentId): assignmentId is string => Boolean(assignmentId)),
        ...linkedTargetRequests.map((row) => row.assignmentId).filter((assignmentId): assignmentId is string => Boolean(assignmentId)),
      ]);

      const blockedDiscardedAssignmentId = discardedAssignmentIds.find((assignmentId) => blockedDiscardedAssignmentIds.has(assignmentId));
      if (blockedDiscardedAssignmentId) {
        const conflict = discardedAssignmentConflictMap.get(blockedDiscardedAssignmentId);
        if (conflict) {
          return NextResponse.json({ success: false, error: `Conflito de plantão em ${conflict.date} (${formatAssignmentPeriod(conflict.period)})` }, { status: 409 });
        }
      }
    }

    const targetCruFixed = alias(cruFixedAssignments, "target_cru_fixed");
    const cruFixedConflicts = await db
      .select({
        dayOfWeek: cruFixedAssignments.dayOfWeek,
        period: cruFixedAssignments.period,
      })
      .from(cruFixedAssignments)
      .innerJoin(targetCruFixed, and(
        eq(targetCruFixed.internId, targetUserId),
        eq(targetCruFixed.dayOfWeek, cruFixedAssignments.dayOfWeek),
        eq(targetCruFixed.period, cruFixedAssignments.period),
        eq(targetCruFixed.isActive, true),
      ))
      .where(and(eq(cruFixedAssignments.internId, sourceUserId), eq(cruFixedAssignments.isActive, true)));

    if (cruFixedConflicts.length > 0) {
      const conflict = cruFixedConflicts[0];
      return NextResponse.json({ success: false, error: `Conflito em CRU fixo ${conflict.dayOfWeek} (${conflict.period === "DAY" ? "diurno" : "noturno"})` }, { status: 409 });
    }

    const sourceRoles = await db.select().from(userRoles).where(eq(userRoles.userId, sourceUserId));
    const targetRoles = await db.select().from(userRoles).where(eq(userRoles.userId, targetUserId));
    const targetRoleKeys = new Set(targetRoles.map((role) => `${role.role}|${role.facultyId ?? "null"}`));

    const [sourceBinding] = await db.select().from(telegramBindings).where(eq(telegramBindings.userId, sourceUserId)).limit(1);
    const [targetBinding] = await db.select().from(telegramBindings).where(eq(telegramBindings.userId, targetUserId)).limit(1);

    const [
      assignmentInternRows,
      assignmentCreatedByRows,
      checkinInternRows,
      checkinValidatedByRows,
      checkinCheckoutConfirmedByRows,
      requestRequesterRows,
      requestTargetInternRows,
      requestReviewedByRows,
      caseRecordInternRows,
      qrSessionInternRows,
      qrSessionConsumedByRows,
      auditLogUserRows,
      inviteCreatedByRows,
      inviteTargetUserRows,
      passwordResetRows,
      cruFixedInternRows,
      cruFixedCreatedByRows,
    ] = await Promise.all([
      db.select({ id: assignments.id }).from(assignments).where(eq(assignments.internId, sourceUserId)),
      db.select({ id: assignments.id }).from(assignments).where(eq(assignments.createdBy, sourceUserId)),
      db.select({ id: checkins.id }).from(checkins).where(eq(checkins.internId, sourceUserId)),
      db.select({ id: checkins.id }).from(checkins).where(eq(checkins.validatedBy, sourceUserId)),
      db.select({ id: checkins.id }).from(checkins).where(eq(checkins.checkoutConfirmedBy, sourceUserId)),
      db.select({ id: requests.id }).from(requests).where(eq(requests.requesterId, sourceUserId)),
      db.select({ id: requests.id }).from(requests).where(eq(requests.targetInternId, sourceUserId)),
      db.select({ id: requests.id }).from(requests).where(eq(requests.reviewedBy, sourceUserId)),
      db.select({ id: caseRecords.id }).from(caseRecords).where(eq(caseRecords.internId, sourceUserId)),
      db.select({ id: qrSessions.id }).from(qrSessions).where(eq(qrSessions.internId, sourceUserId)),
      db.select({ id: qrSessions.id }).from(qrSessions).where(eq(qrSessions.consumedBy, sourceUserId)),
      db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.userId, sourceUserId)),
      db.select({ id: inviteLinks.id }).from(inviteLinks).where(eq(inviteLinks.createdBy, sourceUserId)),
      db.select({ id: inviteLinks.id }).from(inviteLinks).where(eq(inviteLinks.targetUserId, sourceUserId)),
      db.select({ id: passwordResetTokens.id }).from(passwordResetTokens).where(eq(passwordResetTokens.userId, sourceUserId)),
      db.select({ id: cruFixedAssignments.id }).from(cruFixedAssignments).where(eq(cruFixedAssignments.internId, sourceUserId)),
      db.select({ id: cruFixedAssignments.id }).from(cruFixedAssignments).where(eq(cruFixedAssignments.createdBy, sourceUserId)),
    ]);

    const now = new Date();
    const rollbackAvailableUntil = new Date(now.getTime() + MERGE_ROLLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const sourceUserSnapshot: SourceUserSnapshot = {
      name: sourceUser.name,
      cpf: sourceUser.cpf,
      email: sourceUser.email,
      phone: sourceUser.phone,
      passwordHash: sourceUser.passwordHash,
      forcePasswordChange: sourceUser.forcePasswordChange,
      googleId: sourceUser.googleId,
      selfie: sourceUser.selfie,
      selfieUploadedAt: serializeDate(sourceUser.selfieUploadedAt),
      registrationCode: sourceUser.registrationCode,
      isActive: sourceUser.isActive,
      createdAt: sourceUser.createdAt.toISOString(),
      updatedAt: sourceUser.updatedAt.toISOString(),
    };

    const sourceRolesSnapshot: SourceRoleSnapshot[] = sourceRoles.map((sourceRole) => ({
      id: sourceRole.id,
      role: sourceRole.role as SourceRoleSnapshot["role"],
      facultyId: sourceRole.facultyId,
      baseId: sourceRole.baseId,
      isActive: sourceRole.isActive,
    }));

    const sourceBindingSnapshot: SourceBindingSnapshot | null = sourceBinding
      ? {
        id: sourceBinding.id,
        telegramUserId: sourceBinding.telegramUserId,
        telegramName: sourceBinding.telegramName,
        createdAt: sourceBinding.createdAt.toISOString(),
      }
      : null;

    const discardedAssignmentIdSet = new Set(discardedAssignmentRows.map((row) => row.id));
    const discardedAssignmentSnapshots = discardedAssignmentRows.map(serializeAssignmentSnapshot);

    const movedRecords: MergeMovedRecords = {
      assignmentsInternIds: assignmentInternRows.map((row) => row.id).filter((id) => !discardedAssignmentIdSet.has(id)),
      assignmentsCreatedByIds: assignmentCreatedByRows.map((row) => row.id).filter((id) => !discardedAssignmentIdSet.has(id)),
      checkinsInternIds: checkinInternRows.map((row) => row.id),
      checkinsValidatedByIds: checkinValidatedByRows.map((row) => row.id),
      checkinsCheckoutConfirmedByIds: checkinCheckoutConfirmedByRows.map((row) => row.id),
      requestsRequesterIds: requestRequesterRows.map((row) => row.id),
      requestsTargetInternIds: requestTargetInternRows.map((row) => row.id),
      requestsReviewedByIds: requestReviewedByRows.map((row) => row.id),
      caseRecordsInternIds: caseRecordInternRows.map((row) => row.id),
      qrSessionsInternIds: qrSessionInternRows.map((row) => row.id),
      qrSessionsConsumedByIds: qrSessionConsumedByRows.map((row) => row.id),
      auditLogUserIds: auditLogUserRows.map((row) => row.id),
      inviteLinksCreatedByIds: inviteCreatedByRows.map((row) => row.id),
      inviteLinksTargetUserIds: inviteTargetUserRows.map((row) => row.id),
      passwordResetTokenIds: passwordResetRows.map((row) => row.id),
      cruFixedInternIds: cruFixedInternRows.map((row) => row.id),
      cruFixedCreatedByIds: cruFixedCreatedByRows.map((row) => row.id),
      deletedAssignments: discardedAssignmentSnapshots,
      telegramBinding: {
        mode: sourceBinding ? (targetBinding ? "deleted" : "reassigned") : "none",
        bindingId: sourceBinding?.id ?? null,
      },
    };

    await db.transaction(async (tx) => {
      if (discardedAssignmentRows.length > 0) {
        await tx.delete(assignments).where(inArray(assignments.id, discardedAssignmentRows.map((row) => row.id)));
      }

      await tx.update(assignments).set({ internId: targetUserId, updatedAt: now }).where(eq(assignments.internId, sourceUserId));
      await tx.update(assignments).set({ createdBy: targetUserId, updatedAt: now }).where(eq(assignments.createdBy, sourceUserId));

      await tx.update(checkins).set({ internId: targetUserId }).where(eq(checkins.internId, sourceUserId));
      await tx.update(checkins).set({ validatedBy: targetUserId }).where(eq(checkins.validatedBy, sourceUserId));
      await tx.update(checkins).set({ checkoutConfirmedBy: targetUserId }).where(eq(checkins.checkoutConfirmedBy, sourceUserId));

      await tx.update(requests).set({ requesterId: targetUserId }).where(eq(requests.requesterId, sourceUserId));
      await tx.update(requests).set({ targetInternId: targetUserId }).where(eq(requests.targetInternId, sourceUserId));
      await tx.update(requests).set({ reviewedBy: targetUserId }).where(eq(requests.reviewedBy, sourceUserId));

      await tx.update(caseRecords).set({ internId: targetUserId }).where(eq(caseRecords.internId, sourceUserId));

      await tx.update(qrSessions).set({ internId: targetUserId }).where(eq(qrSessions.internId, sourceUserId));
      await tx.update(qrSessions).set({ consumedBy: targetUserId }).where(eq(qrSessions.consumedBy, sourceUserId));

      if (sourceBinding) {
        if (targetBinding) {
          await tx.delete(telegramBindings).where(eq(telegramBindings.id, sourceBinding.id));
        } else {
          await tx.update(telegramBindings).set({ userId: targetUserId }).where(eq(telegramBindings.id, sourceBinding.id));
        }
      }

      await tx.update(auditLog).set({ userId: targetUserId }).where(eq(auditLog.userId, sourceUserId));

      await tx.update(inviteLinks).set({ createdBy: targetUserId }).where(eq(inviteLinks.createdBy, sourceUserId));
      await tx.update(inviteLinks).set({ targetUserId: targetUserId }).where(eq(inviteLinks.targetUserId, sourceUserId));

      await tx.update(passwordResetTokens).set({ userId: targetUserId }).where(eq(passwordResetTokens.userId, sourceUserId));

      await tx.update(cruFixedAssignments).set({ internId: targetUserId }).where(eq(cruFixedAssignments.internId, sourceUserId));
      await tx.update(cruFixedAssignments).set({ createdBy: targetUserId }).where(eq(cruFixedAssignments.createdBy, sourceUserId));

      await tx.update(userRoles).set({ isActive: false }).where(eq(userRoles.userId, sourceUserId));

      const rolesToInsert = sourceRoles
        .filter((sourceRole) => !targetRoleKeys.has(`${sourceRole.role}|${sourceRole.facultyId ?? "null"}`))
        .map((sourceRole) => ({
          userId: targetUserId,
          role: sourceRole.role,
          facultyId: sourceRole.facultyId,
          baseId: sourceRole.baseId,
          isActive: sourceRole.isActive,
        }));

      let insertedTargetRoleIds: string[] = [];
      if (rolesToInsert.length > 0) {
        insertedTargetRoleIds = (await tx.insert(userRoles).values(rolesToInsert).returning({ id: userRoles.id })).map((row) => row.id);
      }

      await tx.update(users).set({
        isActive: false,
        email: buildMergedPlaceholderEmail(sourceUserId),
        cpf: null,
        googleId: null,
        mergedIntoUserId: targetUserId,
        mergedAt: now,
        mergeRollbackExpiresAt: rollbackAvailableUntil,
        updatedAt: now,
      }).where(eq(users.id, sourceUserId));

      await tx.insert(userMergeEvents).values({
        sourceUserId,
        sourceName: sourceUser.name,
        sourceEmail: sourceUser.email,
        targetUserId,
        targetName: targetUser.name,
        targetEmail: targetUser.email,
        performedByUserId: token.id as string,
        sourceUserSnapshot,
        sourceRolesSnapshot,
        sourceBindingSnapshot,
        movedRecords,
        insertedTargetRoleIds,
        rollbackAvailableUntil,
      });
    });

    await logAudit({
      userId: token.id as string,
      action: "MERGE_USER",
      entity: "user",
      entityId: targetUserId,
      payload: {
        sourceUserId,
        sourceEmail: sourceUser.email,
        sourceName: sourceUser.name,
        targetUserId,
        targetEmail: targetUser.email,
        targetName: targetUser.name,
        rollbackAvailableUntil: rollbackAvailableUntil.toISOString(),
        discardedAssignmentIds: discardedAssignmentRows.map((row) => row.id),
      },
    });

    return NextResponse.json({ success: true, data: { rollbackAvailableUntil: rollbackAvailableUntil.toISOString() } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  try {
    const body = await req.json();
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) return NextResponse.json({ success: false, error: "Usuário inválido" }, { status: 400 });
    if (id === token.id) return NextResponse.json({ success: false, error: "Você não pode desativar seu próprio usuário" }, { status: 409 });

    const [existing] = await db.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.id, id)).limit(1);
    if (!existing) return NextResponse.json({ success: false, error: "Usuário não encontrado" }, { status: 404 });

    await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, id));
    await db.update(userRoles).set({ isActive: false }).where(eq(userRoles.userId, id));

    await logAudit({ userId: token.id as string, action: "DEACTIVATE_USER", entity: "user", entityId: id, payload: { previousIsActive: existing.isActive } });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
