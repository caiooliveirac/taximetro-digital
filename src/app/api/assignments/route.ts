import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { createAssignmentSchema, executeCreateAssignment } from "@/features/scheduling/application/use-cases/create-assignment";
import { executeUpdateAssignmentStatus } from "@/features/scheduling/application/use-cases/update-assignment-status";
import { executeListAssignments } from "@/features/scheduling/application/use-cases/list-assignments";

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const dateFrom = searchParams.get("from");
  const dateTo = searchParams.get("to");
  const facultyId = searchParams.get("facultyId");
  const baseId = searchParams.get("baseId");
  const period = searchParams.get("period");
  const internId = searchParams.get("internId");

  const rows = await executeListAssignments({
    actor: {
      id: user.id,
      role: user.role,
      facultyId: user.facultyId,
    },
    filters: {
      from: dateFrom,
      to: dateTo,
      facultyId,
      baseId,
      period,
      internId,
      selfOnly: searchParams.get("selfOnly") === "true",
    },
  });

  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createAssignmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const result = await executeCreateAssignment({
    actor: {
      id: user.id,
      role: user.role,
      facultyId: user.facultyId,
      isImpersonating: user.isImpersonating,
      realUserId: user.realUserId,
    },
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}

export async function PUT(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const result = await executeUpdateAssignmentStatus({
    actor: {
      id: user.id,
      role: user.role,
      facultyId: user.facultyId,
      isImpersonating: user.isImpersonating,
      realUserId: user.realUserId,
    },
    input: {
      id: body?.id,
      status: body?.status,
      notes: body?.notes,
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
