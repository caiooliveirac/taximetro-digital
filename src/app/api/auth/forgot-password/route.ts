import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@/db";
import { users, passwordResetTokens } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getEmailErrorSummary, sendPasswordResetEmail } from "@/lib/email";

function getRequestIp(req: Request) {
    return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || req.headers.get("x-real-ip")
        || null;
}

function maskEmail(email: string) {
    const [local, domain] = email.split("@");
    if (!domain) return "***";
    const safeLocal = local.length <= 2 ? "***" : `${local.slice(0, 2)}***`;
    return `${safeLocal}@${domain}`;
}

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
    const ipAddress = getRequestIp(req);

    await db.insert(passwordResetTokens).values({
        userId: user.id,
        token,
        expiresAt,
    });

    try {
        await sendPasswordResetEmail(user.email, user.name, token);
    } catch (err) {
        const emailError = getEmailErrorSummary(err);

        try {
            await db.delete(passwordResetTokens).where(eq(passwordResetTokens.token, token));
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
            ipAddress,
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
            ipAddress: ipAddress ?? undefined,
        });

        return NextResponse.json({ success: false, error: emailError.message }, { status: emailError.statusCode });
    }

    await logAudit({
        userId: user.id,
        action: "PASSWORD_RESET_EMAIL_SENT",
        entity: "password_reset_token",
        payload: {
            email: maskEmail(user.email),
        },
        ipAddress: ipAddress ?? undefined,
    });

    return NextResponse.json(ok);
}
