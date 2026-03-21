import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { qrSessions } from "@/db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import { z } from "zod/v4";

const schema = z.object({ checkinId: z.string().uuid() });

// Returns remaining seconds for an active code (used by intern checkin page)
export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  // Block impersonation — TOTP is part of the physical check-in flow
  if (req.cookies.get("x-impersonate-user")?.value || req.headers.get("x-impersonate-user")) {
    return NextResponse.json({ success: false, error: "TOTP não pode ser usado via impersonate" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });

  const [session] = await db.select().from(qrSessions)
    .where(and(
      eq(qrSessions.checkinId, parsed.data.checkinId),
      isNull(qrSessions.consumedAt),
      gt(qrSessions.codeExpiresAt, new Date()),
    ))
    .limit(1);

  if (!session) {
    return NextResponse.json({ success: true, data: { expired: true, remaining: 0 } });
  }

  const remaining = Math.max(0, Math.floor((session.codeExpiresAt.getTime() - Date.now()) / 1000));

  return NextResponse.json({ success: true, data: { expired: false, remaining, code: session.activeCode } });
}
