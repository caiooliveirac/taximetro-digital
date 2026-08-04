import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { ORG } from "@/lib/instance";
import { fetchSamuUnifacsCohorts } from "@/features/cohorts/application/use-cases/import-from-samu";

export async function GET(req: NextRequest) {
  if (ORG !== "vitalmed") {
    return NextResponse.json({ success: false, error: "Não encontrado" }, { status: 404 });
  }

  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  try {
    const data = await fetchSamuUnifacsCohorts();
    return NextResponse.json({ success: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
