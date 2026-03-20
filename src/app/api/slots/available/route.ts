import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getAvailableSlots } from "@/lib/slots";

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const facultyId = token.role === "LEADER" ? (token.facultyId as string) : searchParams.get("facultyId") ?? undefined;

  const slots = await getAvailableSlots(facultyId);
  return NextResponse.json({ success: true, data: slots });
}
