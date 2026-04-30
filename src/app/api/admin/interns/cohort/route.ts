import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { cohorts, userRoles } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";

const schema = z.object({
  userRoleId: z.string().uuid(),
  cohortId: z.string().uuid().nullable(),
});

/** PATCH — reassign an intern's cohort (or clear it with cohortId: null) */
export async function PATCH(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const { userRoleId, cohortId } = parsed.data;

  // Fetch the target role
  const [role] = await db
    .select({ id: userRoles.id, userId: userRoles.userId, role: userRoles.role, facultyId: userRoles.facultyId, cohortId: userRoles.cohortId })
    .from(userRoles)
    .where(eq(userRoles.id, userRoleId))
    .limit(1);

  if (!role) {
    return NextResponse.json({ success: false, error: "Role não encontrada" }, { status: 404 });
  }
  if (role.role !== "INTERN") {
    return NextResponse.json({ success: false, error: "Só é possível atribuir turma a internos" }, { status: 422 });
  }

  // Validate cohort belongs to same faculty
  if (cohortId) {
    const [cohort] = await db
      .select({ id: cohorts.id, facultyId: cohorts.facultyId, status: cohorts.status })
      .from(cohorts)
      .where(eq(cohorts.id, cohortId))
      .limit(1);

    if (!cohort) {
      return NextResponse.json({ success: false, error: "Turma não encontrada" }, { status: 404 });
    }
    if (cohort.facultyId !== role.facultyId) {
      return NextResponse.json({ success: false, error: "A turma deve pertencer à mesma faculdade do interno" }, { status: 422 });
    }
    if (cohort.status === "CLOSED") {
      return NextResponse.json({ success: false, error: "Não é possível atribuir internos a turmas fechadas" }, { status: 409 });
    }
  }

  await db.update(userRoles).set({ cohortId }).where(eq(userRoles.id, userRoleId));

  await logAudit({
    userId: token.id as string,
    action: cohortId ? "ASSIGN_COHORT" : "UNASSIGN_COHORT",
    entity: "user_role",
    entityId: userRoleId,
    payload: { userId: role.userId, previousCohortId: role.cohortId, newCohortId: cohortId },
  });

  return NextResponse.json({ success: true });
}
