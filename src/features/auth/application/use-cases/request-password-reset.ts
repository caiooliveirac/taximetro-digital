import { randomBytes } from "crypto";
import { logAudit } from "@/shared/infra/logger/audit";
import { getEmailErrorSummary, sendPasswordResetEmail } from "@/lib/email";
import {
  createPasswordResetToken,
  deletePasswordResetTokenByToken,
  findActiveUserByEmail,
  findRecentPasswordResetToken,
} from "@/features/auth/infra/repositories/password-repository";

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const safeLocal = local.length <= 2 ? "***" : `${local.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
}

export async function executeRequestPasswordReset(params: {
  email: unknown;
  ipAddress?: string | null;
}) {
  if (!params.email || typeof params.email !== "string") {
    return { status: 400, body: { success: false, error: "E-mail obrigatório." } } as const;
  }

  const normalized = params.email.toLowerCase().trim();
  const ok = {
    success: true,
    message: "Se o e-mail estiver cadastrado, você receberá um link de redefinição.",
  };

  const user = await findActiveUserByEmail(normalized);
  if (!user) return { status: 200, body: ok } as const;

  const recent = await findRecentPasswordResetToken(user.id, new Date(Date.now() - 5 * 60 * 1000));
  if (recent) return { status: 200, body: ok } as const;

  const token = randomBytes(32).toString("base64url");
  await createPasswordResetToken({
    userId: user.id,
    token,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  try {
    await sendPasswordResetEmail(user.email, user.name, token);
  } catch (err) {
    const emailError = getEmailErrorSummary(err);

    try {
      await deletePasswordResetTokenByToken(token);
    } catch (cleanupError) {
      console.error("[forgot-password] failed to cleanup unsent reset token", {
        userId: user.id,
        email: maskEmail(user.email),
        tokenPreview: `${token.slice(0, 6)}...`,
        cleanupError,
      });
    }

    console.error("[forgot-password] password reset email failed", {
      userId: user.id,
      email: maskEmail(user.email),
      code: emailError.code,
      retryable: emailError.retryable,
      diagnostic: emailError.diagnostic,
      ipAddress: params.ipAddress ?? null,
    });

    await logAudit({
      userId: user.id,
      action: "PASSWORD_RESET_EMAIL_FAILED",
      entity: "password_reset_token",
      payload: {
        email: maskEmail(user.email),
        code: emailError.code,
        retryable: emailError.retryable,
        diagnostic: emailError.diagnostic,
      },
      ipAddress: params.ipAddress ?? undefined,
    });

    return {
      status: emailError.statusCode,
      body: { success: false, error: emailError.message },
    } as const;
  }

  await logAudit({
    userId: user.id,
    action: "PASSWORD_RESET_EMAIL_SENT",
    entity: "password_reset_token",
    payload: {
      email: maskEmail(user.email),
    },
    ipAddress: params.ipAddress ?? undefined,
  });

  return { status: 200, body: ok } as const;
}
