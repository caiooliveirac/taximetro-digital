import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { inviteLinks, faculties, users, userRoles } from "@/db/schema";
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
      facultyId: inviteLinks.facultyId,
      facultyName: faculties.name,
      facultyAbbr: faculties.abbreviation,
      isActive: inviteLinks.isActive,
      expiresAt: inviteLinks.expiresAt,
    })
    .from(inviteLinks)
    .leftJoin(faculties, eq(faculties.id, inviteLinks.facultyId))
    .where(and(eq(inviteLinks.token, token), eq(inviteLinks.isActive, true)));

  if (!invite) return null;
  if (invite.expiresAt && invite.expiresAt < new Date()) return null;
  return invite;
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
    data: { facultyName: invite.facultyName, facultyAbbr: invite.facultyAbbr },
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

  // Check if CPF already exists (only if provided)
  if (cpf) {
    const [existingCpf] = await db.select({ id: users.id }).from(users).where(eq(users.cpf, cpf));
    if (existingCpf) {
      return NextResponse.json({ success: false, error: "CPF já cadastrado" }, { status: 409 });
    }
  }
  const [existingEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existingEmail) {
    return NextResponse.json({ success: false, error: "E-mail já cadastrado" }, { status: 409 });
  }

  const passwordHash = await hash(password, 12);

  const [user] = await db.insert(users).values({
    name,
    cpf: cpf ?? null,
    email,
    phone,
    passwordHash,
    selfie,
    selfieUploadedAt: new Date(),
    isActive: false, // Pending leader approval
  }).returning();

  await db.insert(userRoles).values({
    userId: user.id,
    role: "INTERN",
    facultyId: invite.facultyId,
  });

  await logAudit({
    action: "SELF_REGISTER",
    entity: "user",
    entityId: user.id,
    payload: { inviteLinkId: invite.id, facultyId: invite.facultyId },
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
