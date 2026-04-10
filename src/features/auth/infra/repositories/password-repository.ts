import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { passwordResetTokens, users } from "@/shared/db/schema";

export async function findActiveUserByEmail(email: string) {
  const [user] = await db.select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.email, email), eq(users.isActive, true)))
    .limit(1);

  return user;
}

export async function findRecentPasswordResetToken(userId: string, createdAfter: Date) {
  const [recent] = await db.select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(and(
      eq(passwordResetTokens.userId, userId),
      gt(passwordResetTokens.createdAt, createdAfter),
    ))
    .limit(1);

  return recent;
}

export async function createPasswordResetToken(params: {
  userId: string;
  token: string;
  expiresAt: Date;
}) {
  await db.insert(passwordResetTokens).values({
    userId: params.userId,
    token: params.token,
    expiresAt: params.expiresAt,
  });
}

export async function deletePasswordResetTokenByToken(token: string) {
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.token, token));
}

export async function findValidPasswordResetToken(token: string) {
  const [resetToken] = await db.select()
    .from(passwordResetTokens)
    .where(and(
      eq(passwordResetTokens.token, token),
      isNull(passwordResetTokens.usedAt),
      gt(passwordResetTokens.expiresAt, new Date()),
    ))
    .limit(1);

  return resetToken;
}

export async function updateUserPassword(params: {
  userId: string;
  passwordHash: string;
}) {
  await db.update(users)
    .set({ passwordHash: params.passwordHash, forcePasswordChange: false, updatedAt: new Date() })
    .where(eq(users.id, params.userId));
}

export async function markPasswordResetTokenUsed(tokenId: string) {
  await db.update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, tokenId));
}

export async function findUserPasswordHashById(userId: string) {
  const [user] = await db.select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user;
}
