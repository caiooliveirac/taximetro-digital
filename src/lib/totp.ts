import crypto from "crypto";
import { db } from "@/db";
import { qrSessions } from "@/db/schema";
import { and, isNull, gt, eq } from "drizzle-orm";

export const CODE_TTL_SECONDS = 300; // 5 minutes

/** Generate a cryptographically random 6-digit code, guaranteed unique among active sessions */
export async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = String(crypto.randomInt(100000, 999999));

    const [exists] = await db
      .select({ id: qrSessions.id })
      .from(qrSessions)
      .where(
        and(
          eq(qrSessions.activeCode, code),
          isNull(qrSessions.consumedAt),
          gt(qrSessions.codeExpiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!exists) return code;
  }
  throw new Error("Não foi possível gerar código único após 20 tentativas");
}

/** Validate a code by exact DB lookup — returns the qrSession if valid */
export async function validateCode(code: string) {
  const [session] = await db
    .select()
    .from(qrSessions)
    .where(
      and(
        eq(qrSessions.activeCode, code),
        isNull(qrSessions.consumedAt),
        gt(qrSessions.codeExpiresAt, new Date()),
      ),
    )
    .limit(1);

  return session ?? null;
}
