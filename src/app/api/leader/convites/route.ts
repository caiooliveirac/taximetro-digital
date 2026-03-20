import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { inviteLinks, faculties } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logAudit } from "@/lib/audit";

async function requireLeaderOrCoordinator(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || !["COORDINATOR", "LEADER"].includes(token.role as string)) return null;
  return token;
}

export async function GET(req: NextRequest) {
  const token = await requireLeaderOrCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const condition = token.role === "LEADER"
    ? eq(inviteLinks.createdBy, token.id as string)
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
  const token = await requireLeaderOrCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const facultyId = token.role === "LEADER" ? (token.facultyId as string) : null;
  if (!facultyId) {
    // Coordinator must specify facultyId
    const body = await req.json().catch(() => ({}));
    if (!body.facultyId) {
      return NextResponse.json({ success: false, error: "facultyId obrigatório" }, { status: 400 });
    }
    const linkToken = randomBytes(12).toString("base64url");
    const [link] = await db.insert(inviteLinks).values({
      token: linkToken,
      createdBy: token.id as string,
      facultyId: body.facultyId,
    }).returning();
    await logAudit({ userId: token.id as string, action: "CREATE_INVITE", entity: "invite_link", entityId: link.id, payload: { facultyId: body.facultyId } });
    return NextResponse.json({ success: true, data: link }, { status: 201 });
  }

  const linkToken = randomBytes(12).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [link] = await db.insert(inviteLinks).values({
    token: linkToken,
    createdBy: token.id as string,
    facultyId,
    expiresAt,
  }).returning();

  await logAudit({ userId: token.id as string, action: "CREATE_INVITE", entity: "invite_link", entityId: link.id, payload: { facultyId } });
  return NextResponse.json({ success: true, data: link }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const token = await requireLeaderOrCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const linkId = searchParams.get("id");
  if (!linkId) return NextResponse.json({ success: false, error: "id obrigatório" }, { status: 400 });

  const conditions = token.role === "LEADER"
    ? and(eq(inviteLinks.id, linkId), eq(inviteLinks.createdBy, token.id as string))
    : eq(inviteLinks.id, linkId);

  const [updated] = await db
    .update(inviteLinks)
    .set({ isActive: false })
    .where(conditions)
    .returning();

  if (!updated) return NextResponse.json({ success: false, error: "Link não encontrado" }, { status: 404 });

  await logAudit({ userId: token.id as string, action: "DEACTIVATE_INVITE", entity: "invite_link", entityId: linkId });
  return NextResponse.json({ success: true });
}
