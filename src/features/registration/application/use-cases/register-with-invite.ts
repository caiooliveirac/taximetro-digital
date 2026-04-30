import { hash } from "bcryptjs";
import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  createPendingUser,
  createUserRole,
  findUserByCpf,
  findUserByEmail,
  findValidInviteByToken,
} from "@/features/registration/infra/repositories/registration-repository";

export const registerWithInviteSchema = z.object({
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

function normalizeInviteScope(invite: Awaited<ReturnType<typeof findValidInviteByToken>>) {
  if (!invite) return { facultyId: null, baseId: null, cohortId: null };

  if (invite.targetRole === "INTERN") {
    return {
      facultyId: invite.facultyId ?? null,
      baseId: null,
      cohortId: invite.cohortId ?? null,
    };
  }

  if (invite.targetRole === "LEADER") {
    return { facultyId: invite.facultyId ?? null, baseId: null, cohortId: null };
  }

  return { facultyId: null, baseId: null, cohortId: null };
}

export async function executeRegisterWithInvite(params: {
  token: string;
  input: z.infer<typeof registerWithInviteSchema>;
}) {
  const invite = await findValidInviteByToken(params.token);
  if (!invite) {
    return { status: 404, body: { success: false, error: "Link inválido ou expirado" } } as const;
  }

  const normalizedEmail = params.input.email.toLowerCase().trim();

  if (params.input.cpf) {
    const existingCpf = await findUserByCpf(params.input.cpf);
    if (existingCpf) {
      return { status: 409, body: { success: false, error: "CPF já cadastrado" } } as const;
    }
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

  const passwordHash = await hash(params.input.password, 12);
  const user = await createPendingUser({
    name: params.input.name,
    cpf: params.input.cpf ?? null,
    email: normalizedEmail,
    phone: params.input.phone,
    passwordHash,
    selfie: params.input.selfie,
  });

  const assignedRole = (invite.targetRole as "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN") ?? "INTERN";
  const normalizedScope = normalizeInviteScope(invite);

  await createUserRole({
    userId: user.id,
    role: assignedRole,
    facultyId: normalizedScope.facultyId,
    baseId: normalizedScope.baseId,
    cohortId: normalizedScope.cohortId,
  });

  await logAudit({
    action: "SELF_REGISTER",
    entity: "user",
    entityId: user.id,
    payload: {
      inviteLinkId: invite.id,
      role: assignedRole,
      facultyId: normalizedScope.facultyId,
      baseId: normalizedScope.baseId,
      cohortId: normalizedScope.cohortId,
    },
  });

  return { status: 201, body: { success: true } } as const;
}

export async function executeGetInviteRegistrationInfo(token: string) {
  const invite = await findValidInviteByToken(token);
  if (!invite) {
    return { status: 404, body: { success: false, error: "Link inválido ou expirado" } } as const;
  }

  return {
    status: 200,
    body: {
      success: true,
      data: {
        targetRole: invite.targetRole ?? "INTERN",
        facultyName: invite.facultyName,
        facultyAbbr: invite.facultyAbbr,
        baseCode: invite.targetRole === "PRECEPTOR" ? null : invite.baseCode,
        baseName: invite.targetRole === "PRECEPTOR" ? null : invite.baseName,
      },
    },
  } as const;
}
