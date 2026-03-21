import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { inviteLinks, faculties } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { getEffectiveUser } from "@/lib/impersonate";

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const condition = user.role === "LEADER"
    ? eq(inviteLinks.createdBy, user.id)
    : undefined;

  const rows = await db
    .select({
      id: inviteLinks.id,
      token: inviteLinks.token,
      facultyId: inviteLinks.facultyId,
      facultyAbbr: faculties.abbreviation,
      isActive: inviteLinks.isActive,
      expiresAt: inviteLinks.expiresAt,
      createdAt: inviteLinks.createdAt,
    })
    .from(inviteLinks)
    .leftJoin(faculties, eq(faculties.id, inviteLinks.facultyId))
    .where(condition)
    .orderBy(inviteLinks.createdAt);

  // If coordinator, return all; if leader, filter was already applied
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const targetRole = (body.targetRole as string) || "INTERN";

  const facultyId = user.role === "LEADER" ? user.facultyId : (body.facultyId as string | undefined);
  if (!facultyId) {
    return NextResponse.json({ success: false, error: "facultyId obrigatório" }, { status: 400 });
  }

  const linkToken = randomBytes(12).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [link] = await db.insert(inviteLinks).values({
    token: linkToken,
    targetRole,
    createdBy: user.realUserId ?? user.id,
    facultyId,
    expiresAt,
  }).returning();

  await logAudit({ userId: user.realUserId ?? user.id, action: "CREATE_INVITE", entity: "invite_link", entityId: link.id, payload: { targetRole, facultyId, ...(user.isImpersonating ? { impersonating: user.id } : {}) } });
  return NextResponse.json({ success: true, data: link }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const linkId = searchParams.get("id");
  if (!linkId) return NextResponse.json({ success: false, error: "id obrigatório" }, { status: 400 });

  const conditions = user.role === "LEADER"
    ? and(eq(inviteLinks.id, linkId), eq(inviteLinks.createdBy, user.id))
    : eq(inviteLinks.id, linkId);

  const [updated] = await db
    .update(inviteLinks)
    .set({ isActive: false })
    .where(conditions)
    .returning();

  if (!updated) return NextResponse.json({ success: false, error: "Link não encontrado" }, { status: 404 });

  await logAudit({ userId: user.realUserId ?? user.id, action: "DEACTIVATE_INVITE", entity: "invite_link", entityId: linkId });
  return NextResponse.json({ success: true });
}
