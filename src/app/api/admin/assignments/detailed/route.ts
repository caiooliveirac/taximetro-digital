import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { executeListDetailedAssignments } from "@/features/admin-assignments/application/use-cases/list-detailed-assignments";

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const result = await executeListDetailedAssignments({
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });

  return NextResponse.json(result.body, { status: result.status });
}