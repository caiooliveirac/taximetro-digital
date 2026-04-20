import { generateSync, verifySync, generateSecret } from "otplib";
import { db } from "@/db";
import { qrSessions } from "@/db/schema";
import { and, isNull, gt, desc } from "drizzle-orm";
import { SESSION_TTL_SECONDS, TOTP_STEP_SECONDS } from "@/lib/totp-config";

// TOTP rotates every 5 minutes; session lasts 15 minutes

const TOTP_OPTS = { period: TOTP_STEP_SECONDS, digits: 6 } as const;

/** Generate a random base32 secret for TOTP */
export function generateTotpSecret(): string {
  return generateSecret();
}

/** Get the current 6-digit code for a TOTP secret */
export function getCurrentCode(secret: string): string {
  return generateSync({ ...TOTP_OPTS, secret });
}

/** Verify a code against a TOTP secret (accepts ±1 period tolerance) */
export function verifyCode(code: string, secret: string): boolean {
  const result = verifySync({ ...TOTP_OPTS, secret, token: code, epochTolerance: TOTP_STEP_SECONDS });
  return result.valid;
}

/**
 * Validate a 6-digit code against all active (non-consumed, non-expired) TOTP sessions.
 * Returns the matching qrSession or null.
 */
export async function validateTotpCode(code: string) {
  const sessions = await db
    .select()
    .from(qrSessions)
    .where(
      and(
        isNull(qrSessions.consumedAt),
        gt(qrSessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(qrSessions.createdAt));

  // Fast path: exact activeCode match from the newest active session.
  const byActiveCode = sessions.find((session) => session.activeCode === code);
  if (byActiveCode) return byActiveCode;

  for (const session of sessions) {
    if (verifyCode(code, session.totpSecret)) {
      return session;
    }
  }
  return null;
}

// Keep legacy validateCode as alias for backward compatibility
export const validateCode = validateTotpCode;
