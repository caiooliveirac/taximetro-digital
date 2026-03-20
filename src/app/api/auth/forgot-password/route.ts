import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@/db";
import { users, passwordResetTokens } from "@/db/schema";
import { sendPasswordResetEmail } from "@/lib/email";

export async function POST(req: Request) {
  const { email } = await req.json();
  if (!email || typeof email !== "string") {
    return NextResponse.json({ success: false, error: "E-mail obrigatório." }, { status: 400 });
  }

  const normalized = email.toLowerCase().trim();

  // Always return success to prevent email enumeration
  const ok = { success: true, message: "Se o e-mail estiver cadastrado, você receberá um link de redefinição." };

  const [user] = await db.select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.email, normalized), eq(users.isActive, true)))
    .limit(1);

  if (!user) return NextResponse.json(ok);

  // Rate limit: max 1 active token per user in the last 5 minutes
  const [recent] = await db.select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(and(
      eq(passwordResetTokens.userId, user.id),
      gt(passwordResetTokens.createdAt, new Date(Date.now() - 5 * 60 * 1000)),
    ))
    .limit(1);

  if (recent) return NextResponse.json(ok);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    token,
    expiresAt,
  });

  try {
    await sendPasswordResetEmail(user.email, user.name, token);
  } catch (err) {
    console.error("Failed to send password reset email:", err);
    return NextResponse.json({ success: false, error: "Erro ao enviar e-mail. Tente novamente." }, { status: 500 });
  }

  return NextResponse.json(ok);
}
