import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { executeGetComplianceOverview } from "@/features/compliance/application/use-cases/get-compliance-overview";

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const result = await executeGetComplianceOverview({
    actor: {
      id: user.id,
      role: user.role,
      facultyId: user.facultyId,
    },
    selfOnly: searchParams.get("selfOnly") === "true",
    facultyId: searchParams.get("facultyId"),
    internId: searchParams.get("internId"),
  });

  return NextResponse.json({
    success: true,
    data: result.data,
    summary: result.summary,
  });
}
