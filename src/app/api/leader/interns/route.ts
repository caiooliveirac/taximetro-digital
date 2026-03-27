import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, userRoles } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { getEffectiveUser } from "@/lib/impersonate";
import { z } from "zod/v4";

/** GET — all interns (active + inactive roles) for the leader's faculty */
export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "LEADER" || !user.facultyId) {
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
      and(eq(userRoles.userId, users.id), inArray(userRoles.role, ["INTERN", "LEADER"])),
    )
    .where(eq(userRoles.facultyId, user.facultyId))
    .orderBy(users.name);

  const deduped = new Map<string, { id: string; name: string; userActive: boolean; roleActive: boolean }>();
  for (const row of rows) {
    const existing = deduped.get(row.id);
    if (!existing) {
      deduped.set(row.id, row);
      continue;
    }

    deduped.set(row.id, {
      ...existing,
      userActive: existing.userActive || row.userActive,
      roleActive: existing.roleActive || row.roleActive,
    });
  }

  return NextResponse.json({ success: true, data: [...deduped.values()] });
}

const patchSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(["deactivate", "reactivate"]),
});

/** PATCH — deactivate / reactivate an intern role (soft‑delete) */
export async function PATCH(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "LEADER" || !user.facultyId) {
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
        eq(userRoles.facultyId, user.facultyId),
      ),
    );

  await logAudit({
    userId: user.realUserId ?? user.id,
    action: action === "deactivate" ? "DEACTIVATE_INTERN" : "REACTIVATE_INTERN",
    entity: "user_role",
    entityId: userId,
    payload: { facultyId: user.facultyId, ...(user.isImpersonating ? { impersonating: user.id } : {}) },
  });

  return NextResponse.json({ success: true });
}
