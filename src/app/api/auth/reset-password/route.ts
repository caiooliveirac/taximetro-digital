import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/db";
import { users, passwordResetTokens } from "@/db/schema";

export async function POST(req: Request) {
    const { token, password } = await req.json();

    if (!token || typeof token !== "string") {
        return NextResponse.json({ success: false, error: "Token inválido." }, { status: 400 });
    }
    if (!password || typeof password !== "string" || password.length < 8) {
        return NextResponse.json({ success: false, error: "Senha deve ter no mínimo 8 caracteres." }, { status: 400 });
    }

    const [resetToken] = await db.select()
        .from(passwordResetTokens)
        .where(and(
            eq(passwordResetTokens.token, token),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
        ))
        .limit(1);

    if (!resetToken) {
        return NextResponse.json({ success: false, error: "Link expirado ou já utilizado. Solicite um novo." }, { status: 400 });
    }

    const passwordHash = await hash(password, 10);

    await db.update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, resetToken.userId));

    await db.update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, resetToken.id));

    return NextResponse.json({ success: true });
}
