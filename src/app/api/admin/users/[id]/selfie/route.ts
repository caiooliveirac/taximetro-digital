import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { tokenHasRole } from "@/lib/roles";

// Serve a selfie como imagem binária com cache, para a lista/galeria
// usar <img src> com lazy-load em vez de base64 gigante no JSON.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  // Preceptor também: reconhece o interno na base antes de validar presença.
  if (!token || !(["COORDINATOR", "LEADER", "PRECEPTOR"] as const).some((role) => tokenHasRole(token, role))) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const { id } = await params;
  const [row] = await db.select({ selfie: users.selfie }).from(users).where(eq(users.id, id)).limit(1);
  if (!row?.selfie) {
    return new NextResponse(null, { status: 404 });
  }

  const match = row.selfie.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/);
  if (!match) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(Buffer.from(match[2], "base64"), {
    headers: {
      "Content-Type": match[1],
      "Cache-Control": "private, max-age=3600",
    },
  });
}
