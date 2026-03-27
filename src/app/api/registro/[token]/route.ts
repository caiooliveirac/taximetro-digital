import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { inviteLinks, faculties, bases, users, userRoles } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { hash } from "bcryptjs";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";

const registerSchema = z.object({
  name: z.string().min(2).max(255),
  cpf: z.string().regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/).optional(),
  email: z.string().email(),
  phone: z.string().min(14).max(20),
  password: z.string().min(8).refine(
    (v) => /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v),
    "Senha deve ter maiúscula, minúscula e número",
  ),
  selfie: z.string().min(1),
});

async function getValidInvite(token: string) {
  const [invite] = await db
    .select({
      id: inviteLinks.id,
      targetRole: inviteLinks.targetRole,
      facultyId: inviteLinks.facultyId,
      facultyName: faculties.name,
      facultyAbbr: faculties.abbreviation,
      baseId: inviteLinks.baseId,
      baseCode: bases.code,
      baseName: bases.name,
      isActive: inviteLinks.isActive,
      expiresAt: inviteLinks.expiresAt,
    })
    .from(inviteLinks)
    .leftJoin(faculties, eq(faculties.id, inviteLinks.facultyId))
    .leftJoin(bases, eq(bases.id, inviteLinks.baseId))
    .where(and(eq(inviteLinks.token, token), eq(inviteLinks.isActive, true)));

  if (!invite) return null;
  if (invite.expiresAt && invite.expiresAt < new Date()) return null;
  return invite;
}

function normalizeInviteScope(invite: Awaited<ReturnType<typeof getValidInvite>>) {
  if (!invite) return { facultyId: null, baseId: null };

  if (invite.targetRole === "INTERN" || invite.targetRole === "LEADER") {
    return { facultyId: invite.facultyId ?? null, baseId: null };
  }

  if (invite.targetRole === "PRECEPTOR") {
    return { facultyId: null, baseId: null };
  }

  return { facultyId: null, baseId: null };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const invite = await getValidInvite(token);
  if (!invite) {
    return NextResponse.json({ success: false, error: "Link inválido ou expirado" }, { status: 404 });
  }
  return NextResponse.json({
    success: true,
    data: {
      targetRole: invite.targetRole ?? "INTERN",
      facultyName: invite.facultyName,
      facultyAbbr: invite.facultyAbbr,
      baseCode: invite.targetRole === "PRECEPTOR" ? null : invite.baseCode,
      baseName: invite.targetRole === "PRECEPTOR" ? null : invite.baseName,
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const invite = await getValidInvite(token);
  if (!invite) {
    return NextResponse.json({ success: false, error: "Link inválido ou expirado" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const { name, cpf, email, phone, password, selfie } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  // Check if CPF already exists (only if provided)
  if (cpf) {
    const [existingCpf] = await db.select({ id: users.id }).from(users).where(eq(users.cpf, cpf));
    if (existingCpf) {
      return NextResponse.json({ success: false, error: "CPF já cadastrado" }, { status: 409 });
    }
  }
  const [existingEmail] = await db.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.email, normalizedEmail));
  if (existingEmail) {
    return NextResponse.json({
      success: false,
      error: existingEmail.isActive
        ? "Este e-mail ja esta cadastrado. Se voce ja criou sua senha, entre pelo login."
        : "Seu cadastro ja foi enviado e ainda esta aguardando aprovacao. Se voce ja criou sua senha, use o login e aguarde liberacao.",
    }, { status: 409 });
  }

  const passwordHash = await hash(password, 12);

  const [user] = await db.insert(users).values({
    name,
    cpf: cpf ?? null,
    email: normalizedEmail,
    phone,
    passwordHash,
    selfie,
    selfieUploadedAt: new Date(),
    isActive: false, // Pending leader approval
  }).returning();

  const assignedRole = (invite.targetRole as "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN") ?? "INTERN";
  const normalizedScope = normalizeInviteScope(invite);

  await db.insert(userRoles).values({
    userId: user.id,
    role: assignedRole,
    facultyId: normalizedScope.facultyId,
    baseId: normalizedScope.baseId,
  });

  await logAudit({
    action: "SELF_REGISTER",
    entity: "user",
    entityId: user.id,
    payload: { inviteLinkId: invite.id, role: assignedRole, facultyId: normalizedScope.facultyId, baseId: normalizedScope.baseId },
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
