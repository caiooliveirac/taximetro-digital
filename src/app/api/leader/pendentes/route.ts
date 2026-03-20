import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { users, userRoles, faculties } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";

const actionSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
});

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
      isActive: users.isActive,
      createdAt: users.createdAt,
      facultyId: userRoles.facultyId,
      facultyAbbr: faculties.abbreviation,
    })
    .from(users)
    .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.role, "INTERN")))
    .leftJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .where(eq(users.isActive, false))
    .orderBy(users.createdAt);

  const filtered = token.role === "LEADER"
    ? rows.filter((r) => r.facultyId === token.facultyId)
    : rows;

  return NextResponse.json({ success: true, data: filtered });
}

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || !["COORDINATOR", "LEADER"].includes(token.role as string)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const { userId, action } = parsed.data;

  // For leader, verify the user belongs to their faculty
  if (token.role === "LEADER") {
    const [role] = await db
      .select({ facultyId: userRoles.facultyId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.role, "INTERN")));
    if (!role || role.facultyId !== token.facultyId) {
      return NextResponse.json({ success: false, error: "Sem permissão para este interno" }, { status: 403 });
    }
  }

  if (action === "approve") {
    await db.update(users).set({ isActive: true, updatedAt: new Date() }).where(eq(users.id, userId));
  } else {
    // Reject: delete the user and role
    await db.delete(userRoles).where(eq(userRoles.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }

  await logAudit({
    userId: token.id as string,
    action: action === "approve" ? "APPROVE_INTERN" : "REJECT_INTERN",
    entity: "user",
    entityId: userId,
  });

  return NextResponse.json({ success: true });
}
