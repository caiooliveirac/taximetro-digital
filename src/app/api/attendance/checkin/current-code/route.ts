import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { qrSessions } from "@/db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import { getCurrentCode } from "@/lib/totp";

export async function GET(req: NextRequest) {
    const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
    if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

    const checkinId = req.nextUrl.searchParams.get("checkinId");
    if (!checkinId) return NextResponse.json({ success: false, error: "checkinId obrigatório" }, { status: 400 });

    const [session] = await db.select().from(qrSessions)
        .where(and(
            eq(qrSessions.checkinId, checkinId),
            isNull(qrSessions.consumedAt),
            gt(qrSessions.expiresAt, new Date()),
        ))
        .limit(1);

    if (!session) {
        return NextResponse.json({ success: false, error: "Sessão expirada" });
    }

    const code = getCurrentCode(session.totpSecret);
    const remaining = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));

    return NextResponse.json({ success: true, code, remaining });
}
