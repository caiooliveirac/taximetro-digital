import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { users, userRoles } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";

/** GET — all interns (active + inactive roles) for the leader's faculty */
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || token.role !== "LEADER" || !token.facultyId) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      userActive: users.isActive,
      roleActive: userRoles.isActive,
    })
    .from(users)
    .innerJoin(
      userRoles,
      and(eq(userRoles.userId, users.id), eq(userRoles.role, "INTERN")),
    )
    .where(eq(userRoles.facultyId, token.facultyId as string))
    .orderBy(users.name);

  return NextResponse.json({ success: true, data: rows });
}

const patchSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(["deactivate", "reactivate"]),
});

/** PATCH — deactivate / reactivate an intern role (soft‑delete) */
export async function PATCH(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || token.role !== "LEADER" || !token.facultyId) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const { userId, action } = parsed.data;
  const newActive = action === "reactivate";

  await db
    .update(userRoles)
    .set({ isActive: newActive })
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.role, "INTERN"),
        eq(userRoles.facultyId, token.facultyId as string),
      ),
    );

  await logAudit({
    userId: token.id as string,
    action: action === "deactivate" ? "DEACTIVATE_INTERN" : "REACTIVATE_INTERN",
    entity: "user_role",
    entityId: userId,
    payload: { facultyId: token.facultyId },
  });

  return NextResponse.json({ success: true });
}
