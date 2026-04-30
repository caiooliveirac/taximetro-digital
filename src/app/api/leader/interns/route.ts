import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
  executeListFacultyInterns,
} from "@/features/user-management/application/use-cases/list-faculty-interns";
import {
  executeUpdateInternStatus,
  updateInternStatusSchema,
} from "@/features/user-management/application/use-cases/update-intern-status";

/** GET — all interns (active + inactive roles) for the leader's faculty */
export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "LEADER" || !user.facultyId) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const data = await executeListFacultyInterns(user.facultyId, user.cohortId ?? null);
  return NextResponse.json({ success: true, data });
}

/** PATCH — deactivate / reactivate / archive / unarchive an intern role */
export async function PATCH(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "LEADER" || !user.facultyId) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = updateInternStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const result = await executeUpdateInternStatus({
    actor: {
      id: user.id,
      facultyId: user.facultyId,
      isImpersonating: user.isImpersonating,
      realUserId: user.realUserId,
    },
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}
