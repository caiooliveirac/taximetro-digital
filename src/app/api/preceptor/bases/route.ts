import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { bases } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || !["PRECEPTOR", "COORDINATOR"].includes(token.role as string)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const rows = await db
    .select({ id: bases.id, code: bases.code, name: bases.name, type: bases.type })
    .from(bases)
    .where(eq(bases.isActive, true))
    .orderBy(bases.code);

  return NextResponse.json({ success: true, data: rows });
}
