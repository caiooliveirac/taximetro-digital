import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { executeListAlerts } from "@/features/alerts/application/use-cases/list-alerts";

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || !["COORDINATOR", "LEADER"].includes(token.role as string))
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const rows = await executeListAlerts({
    role: token.role as string,
    facultyId: (token.facultyId as string | null) ?? null,
  });

  return NextResponse.json({ success: true, data: rows });
}
