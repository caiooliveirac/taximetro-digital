import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { executeGetDetailedAssignmentById } from "@/features/admin-assignments/application/use-cases/list-detailed-assignments";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === "production",
  });

  if (!token || token.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const params = await context.params;
  const result = await executeGetDetailedAssignmentById({ id: params.id });
  return NextResponse.json(result.body, { status: result.status });
}
