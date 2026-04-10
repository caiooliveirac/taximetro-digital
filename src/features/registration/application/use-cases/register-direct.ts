import { hash } from "bcryptjs";
import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  createPendingUser,
  createUserRole,
  findUserByCpf,
  findUserByEmail,
} from "@/features/registration/infra/repositories/registration-repository";

export const directRegistrationSchema = z.object({
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

export async function executeDirectRegistration(input: z.infer<typeof directRegistrationSchema>) {
  const normalizedEmail = input.email.toLowerCase().trim();
  const normalizedFacultyId = input.role === "INTERN" || input.role === "LEADER" ? (input.facultyId ?? null) : null;
  const normalizedBaseId = input.role === "PRECEPTOR" ? null : (input.baseId ?? null);

  if ((input.role === "INTERN" || input.role === "LEADER") && !normalizedFacultyId) {
    return { status: 400, body: { success: false, error: "Faculdade obrigatória para esse papel" } } as const;
  }

  const existingEmail = await findUserByEmail(normalizedEmail);
  if (existingEmail) {
    return {
      status: 409,
      body: {
        success: false,
        error: existingEmail.isActive
          ? "Este e-mail ja esta cadastrado. Se voce ja criou sua senha, entre pelo login."
          : "Seu cadastro ja foi enviado e ainda esta aguardando aprovacao. Se voce ja criou sua senha, use o login e aguarde liberacao.",
      },
    } as const;
  }

  if (input.cpf) {
    const existingCpf = await findUserByCpf(input.cpf);
    if (existingCpf) {
      return { status: 409, body: { success: false, error: "CPF já cadastrado" } } as const;
    }
  }

  const passwordHash = await hash(input.password, 12);
  const user = await createPendingUser({
    name: input.name,
    email: normalizedEmail,
    cpf: input.cpf ?? null,
    phone: input.phone,
    passwordHash,
    selfie: input.selfie,
  });

  await createUserRole({
    userId: user.id,
    role: input.role,
    facultyId: normalizedFacultyId,
    baseId: normalizedBaseId,
  });

  await logAudit({
    action: "SELF_REGISTER_GOOGLE",
    entity: "user",
    entityId: user.id,
    payload: { role: input.role, facultyId: normalizedFacultyId, baseId: normalizedBaseId, email: input.email },
  });

  return { status: 201, body: { success: true } } as const;
}
