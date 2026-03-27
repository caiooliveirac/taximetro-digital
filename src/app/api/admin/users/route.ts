import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { users, userRoles, faculties, bases, assignments, checkins, requests, caseRecords, qrSessions, telegramBindings, auditLog, inviteLinks, passwordResetTokens, cruFixedAssignments } from "@/db/schema";
import { eq, and, ne, sql } from "drizzle-orm";
import { hash } from "bcryptjs";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";
import { alias } from "drizzle-orm/pg-core";

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
};

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

  // Leader can only see their faculty's users
  const filtered = token.role === "LEADER"
    ? aggregated.filter((row) => row.facultyId === token.facultyId)
    : aggregated;

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

  if (alsoPreceptor && role !== "PRECEPTOR") {
    await db.insert(userRoles).values({
      userId: user.id,
      role: "PRECEPTOR",
      facultyId: null,
      baseId: null,
    });
  }

  await logAudit({ userId: token.id as string, action: "CREATE_USER", entity: "user", entityId: user.id, payload: { role, facultyId: normalizedScope.facultyId, baseId: normalizedScope.baseId, alsoPreceptor: Boolean(alsoPreceptor && role !== "PRECEPTOR") } });
  return NextResponse.json({ success: true, data: { ...user, role, facultyId: normalizedScope.facultyId, baseId: normalizedScope.baseId, alsoPreceptor: Boolean(alsoPreceptor && role !== "PRECEPTOR") } }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  try {
    const body = await req.json();
    if (typeof body?.email === "string") body.email = body.email.trim().toLowerCase();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

    const { id, password, role, facultyId, baseId, alsoPreceptor, ...userData } = parsed.data;

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

    const [updated] = await db.update(users).set(updateData).where(eq(users.id, id)).returning();
    if (!updated) return NextResponse.json({ success: false, error: "Usuário não encontrado" }, { status: 404 });

    if (role !== undefined) {
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

      if (alsoPreceptor && role !== "PRECEPTOR") {
        await db.insert(userRoles).values({
          userId: id,
          role: "PRECEPTOR",
          facultyId: null,
          baseId: null,
        });
      }
    }

    const normalizedScope = role !== undefined ? normalizeRoleScope(role, facultyId, baseId) : { facultyId, baseId };
    await logAudit({ userId: token.id as string, action: "UPDATE_USER", entity: "user", entityId: id, payload: { role, facultyId: normalizedScope.facultyId ?? null, baseId: normalizedScope.baseId ?? null, email: userData.email ?? null, passwordChanged: Boolean(password), alsoPreceptor: Boolean(alsoPreceptor && role && role !== "PRECEPTOR") } });
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

    const targetAssignment = alias(assignments, "target_assignment");
    const assignmentConflicts = await db
      .select({
        date: assignments.date,
        period: assignments.period,
      })
      .from(assignments)
      .innerJoin(targetAssignment, and(
        eq(targetAssignment.internId, targetUserId),
        eq(targetAssignment.date, assignments.date),
        eq(targetAssignment.period, assignments.period),
      ))
      .where(eq(assignments.internId, sourceUserId));

    if (assignmentConflicts.length > 0) {
      const conflict = assignmentConflicts[0];
      return NextResponse.json({ success: false, error: `Conflito de plantão em ${conflict.date} (${conflict.period === "DAY" ? "diurno" : "noturno"})` }, { status: 409 });
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

    await db.transaction(async (tx) => {
      await tx.update(assignments).set({ internId: targetUserId, updatedAt: new Date() }).where(eq(assignments.internId, sourceUserId));
      await tx.update(assignments).set({ createdBy: targetUserId, updatedAt: new Date() }).where(eq(assignments.createdBy, sourceUserId));

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

      for (const sourceRole of sourceRoles) {
        const roleKey = `${sourceRole.role}|${sourceRole.facultyId ?? "null"}`;
        if (targetRoleKeys.has(roleKey)) {
          await tx.delete(userRoles).where(eq(userRoles.id, sourceRole.id));
        } else {
          await tx.update(userRoles).set({ userId: targetUserId }).where(eq(userRoles.id, sourceRole.id));
        }
      }

      await tx.delete(users).where(eq(users.id, sourceUserId));
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
      },
    });

    return NextResponse.json({ success: true });
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
