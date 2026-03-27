import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, userRoles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcryptjs";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";

const registerSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email(),
  cpf: z.string().regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/).optional(),
  phone: z.string().min(14).max(20),
  role: z.enum(["COORDINATOR", "LEADER", "PRECEPTOR", "INTERN"]),
  facultyId: z.string().uuid().optional(),
  baseId: z.string().uuid().optional(),
  selfie: z.string().min(1),
  password: z.string().min(8).refine(
    (v) => /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v),
    "Senha deve ter maiúscula, minúscula e número",
  ),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const { name, email, cpf, phone, role, facultyId, baseId, selfie, password } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedFacultyId = role === "INTERN" || role === "LEADER" ? (facultyId ?? null) : null;
  const normalizedBaseId = role === "PRECEPTOR" ? null : (baseId ?? null);

  // Validate faculty/base requirements
  if ((role === "INTERN" || role === "LEADER") && !normalizedFacultyId) {
    return NextResponse.json({ success: false, error: "Faculdade obrigatória para esse papel" }, { status: 400 });
  }

  // Check duplicate email
  const [existingEmail] = await db.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.email, normalizedEmail));
  if (existingEmail) {
    return NextResponse.json({
      success: false,
      error: existingEmail.isActive
        ? "Este e-mail ja esta cadastrado. Se voce ja criou sua senha, entre pelo login."
        : "Seu cadastro ja foi enviado e ainda esta aguardando aprovacao. Se voce ja criou sua senha, use o login e aguarde liberacao.",
    }, { status: 409 });
  }

  // Check duplicate CPF
  if (cpf) {
    const [existingCpf] = await db.select({ id: users.id }).from(users).where(eq(users.cpf, cpf));
    if (existingCpf) {
      return NextResponse.json({ success: false, error: "CPF já cadastrado" }, { status: 409 });
    }
  }

  const passwordHash = await hash(password, 12);

  const [user] = await db.insert(users).values({
    name,
    email: normalizedEmail,
    cpf: cpf ?? null,
    phone,
    passwordHash,
    selfie,
    selfieUploadedAt: new Date(),
    isActive: false, // Pending coordinator approval
  }).returning();

  await db.insert(userRoles).values({
    userId: user.id,
    role,
    facultyId: normalizedFacultyId,
    baseId: normalizedBaseId,
  });

  await logAudit({
    action: "SELF_REGISTER_GOOGLE",
    entity: "user",
    entityId: user.id,
    payload: { role, facultyId: normalizedFacultyId, baseId: normalizedBaseId, email },
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
