import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { executeListAuditLog } from "@/features/audit/application/use-cases/list-audit-log";

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || token.role !== "COORDINATOR")
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const data = await executeListAuditLog();

  return NextResponse.json({ success: true, data });
}
