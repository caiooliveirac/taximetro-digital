import { NextResponse } from "next/server";
import { compare, hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";

export async function POST(req: Request) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ success: false, error: "Não autenticado." }, { status: 401 });
    }

    const { currentPassword, newPassword } = await req.json();

    if (!currentPassword || typeof currentPassword !== "string") {
        return NextResponse.json({ success: false, error: "Senha atual obrigatória." }, { status: 400 });
    }
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
        return NextResponse.json({ success: false, error: "Nova senha deve ter no mínimo 8 caracteres." }, { status: 400 });
    }

    const [user] = await db.select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

    if (!user) {
        return NextResponse.json({ success: false, error: "Usuário não encontrado." }, { status: 404 });
    }

    const valid = await compare(currentPassword, user.passwordHash);
    if (!valid) {
        return NextResponse.json({ success: false, error: "Senha atual incorreta." }, { status: 400 });
    }

    const passwordHash = await hash(newPassword, 10);

    await db.update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, user.id));

    return NextResponse.json({ success: true });
}
