import { compare, hash } from "bcryptjs";
import {
  findUserPasswordHashById,
  updateUserPassword,
} from "@/features/auth/infra/repositories/password-repository";

export async function executeChangePassword(params: {
  userId: string;
  currentPassword: unknown;
  newPassword: unknown;
}) {
  if (!params.currentPassword || typeof params.currentPassword !== "string") {
    return { status: 400, body: { success: false, error: "Senha atual obrigatória." } } as const;
  }
  if (!params.newPassword || typeof params.newPassword !== "string" || params.newPassword.length < 8) {
    return {
      status: 400,
      body: { success: false, error: "Nova senha deve ter no mínimo 8 caracteres." },
    } as const;
  }

  const user = await findUserPasswordHashById(params.userId);
  if (!user) {
    return { status: 404, body: { success: false, error: "Usuário não encontrado." } } as const;
  }

  const valid = await compare(params.currentPassword, user.passwordHash);
  if (!valid) {
    return { status: 400, body: { success: false, error: "Senha atual incorreta." } } as const;
  }

  const passwordHash = await hash(params.newPassword, 10);
  await updateUserPassword({ userId: user.id, passwordHash });

  return { status: 200, body: { success: true } } as const;
}
