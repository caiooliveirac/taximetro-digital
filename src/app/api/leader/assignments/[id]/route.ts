import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { executeGetDetailedAssignmentById } from "@/features/admin-assignments/application/use-cases/list-detailed-assignments";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const actor = await getEffectiveUser(req);
  if (!actor || actor.role !== "LEADER") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const params = await context.params;
  const result = await executeGetDetailedAssignmentById({ id: params.id });

  if (!result.body.success) {
    return NextResponse.json(result.body, { status: result.status });
  }

  const assignment = (result.body as { success: true; data: Record<string, unknown> }).data;
  if (assignment.faculty_id !== actor.facultyId) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  return NextResponse.json(result.body, { status: result.status });
}
