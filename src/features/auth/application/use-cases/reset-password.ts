import { hash } from "bcryptjs";
import {
  findValidPasswordResetToken,
  markPasswordResetTokenUsed,
  updateUserPassword,
} from "@/features/auth/infra/repositories/password-repository";

export async function executeResetPassword(params: {
  token: unknown;
  password: unknown;
}) {
  if (!params.token || typeof params.token !== "string") {
    return { status: 400, body: { success: false, error: "Token inválido." } } as const;
  }
  if (!params.password || typeof params.password !== "string" || params.password.length < 8) {
    return {
      status: 400,
      body: { success: false, error: "Senha deve ter no mínimo 8 caracteres." },
    } as const;
  }

  const resetToken = await findValidPasswordResetToken(params.token);
  if (!resetToken) {
    return {
      status: 400,
      body: { success: false, error: "Link expirado ou já utilizado. Solicite um novo." },
    } as const;
  }

  const passwordHash = await hash(params.password, 10);
  await updateUserPassword({ userId: resetToken.userId, passwordHash });
  await markPasswordResetTokenUsed(resetToken.id);

  return { status: 200, body: { success: true } } as const;
}
