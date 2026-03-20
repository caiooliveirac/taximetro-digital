import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { users, userRoles, faculties, bases } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { hash } from "bcryptjs";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";

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
});

const updateUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(255).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  registrationCode: z.string().max(20).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(["COORDINATOR", "LEADER", "PRECEPTOR", "INTERN"]).optional(),
  facultyId: z.string().uuid().nullable().optional(),
  baseId: z.string().uuid().nullable().optional(),
});

async function requireCoordinator(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || token.role !== "COORDINATOR") return null;
  return token;
}

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || !["COORDINATOR", "LEADER"].includes(token.role as string)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      cpf: users.cpf,
      email: users.email,
      phone: users.phone,
      registrationCode: users.registrationCode,
      isActive: users.isActive,
      selfie: users.selfie,
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

  // Leader can only see their faculty's users
  const filtered = token.role === "LEADER"
    ? rows.filter((r) => r.facultyId === token.facultyId)
    : rows;

  return NextResponse.json({ success: true, data: filtered });
}

export async function POST(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const body = await req.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const { password, role, facultyId, baseId, ...userData } = parsed.data;
  const passwordHash = await hash(password, 12);

  const [user] = await db.insert(users).values({ ...userData, passwordHash }).returning();

  await db.insert(userRoles).values({
    userId: user.id,
    role,
    facultyId: facultyId ?? null,
    baseId: baseId ?? null,
  });

  await logAudit({ userId: token.id as string, action: "CREATE_USER", entity: "user", entityId: user.id, payload: { role, facultyId } });
  return NextResponse.json({ success: true, data: { ...user, role, facultyId } }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const body = await req.json();
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const { id, password, role, facultyId, baseId, ...userData } = parsed.data;

  const updateData: Record<string, unknown> = { ...userData, updatedAt: new Date() };
  if (password) updateData.passwordHash = await hash(password, 12);

  const [updated] = await db.update(users).set(updateData).where(eq(users.id, id)).returning();
  if (!updated) return NextResponse.json({ success: false, error: "Usuário não encontrado" }, { status: 404 });

  if (role !== undefined) {
    await db.update(userRoles).set({ isActive: false }).where(eq(userRoles.userId, id));
    await db.insert(userRoles).values({
      userId: id,
      role,
      facultyId: facultyId ?? null,
      baseId: baseId ?? null,
    });
  }

  await logAudit({ userId: token.id as string, action: "UPDATE_USER", entity: "user", entityId: id, payload: { role, facultyId } });
  return NextResponse.json({ success: true, data: updated });
}
