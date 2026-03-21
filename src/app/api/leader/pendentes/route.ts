import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, userRoles, faculties } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { getEffectiveUser } from "@/lib/impersonate";
import { z } from "zod/v4";

const actionSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
});

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
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
      role: userRoles.role,
      facultyId: userRoles.facultyId,
      facultyAbbr: faculties.abbreviation,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .where(eq(users.isActive, false))
    .orderBy(users.createdAt);

  const filtered = user.role === "LEADER"
    ? rows.filter((r) => r.facultyId === user.facultyId && r.role === "INTERN")
    : rows;

  return NextResponse.json({ success: true, data: filtered });
}

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const { userId, action } = parsed.data;

  // For leader, verify the user belongs to their faculty
  if (user.role === "LEADER") {
    const [role] = await db
      .select({ facultyId: userRoles.facultyId })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));
    if (!role || role.facultyId !== user.facultyId) {
      return NextResponse.json({ success: false, error: "Sem permissão para este usuário" }, { status: 403 });
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
    userId: user.realUserId ?? user.id,
    action: action === "approve" ? "APPROVE_USER" : "REJECT_USER",
    entity: "user",
    entityId: userId,
  });

  return NextResponse.json({ success: true });
}
