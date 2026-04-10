import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
  executeCreateInviteLink,
  executeDeactivateInviteLink,
  executeListInviteLinks,
} from "@/features/user-management/application/use-cases/manage-invite-links";

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const rows = await executeListInviteLinks({
    id: user.id,
    role: user.role,
    facultyId: user.facultyId,
    isImpersonating: user.isImpersonating,
    realUserId: user.realUserId,
  });

  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const result = await executeCreateInviteLink({
    actor: {
      id: user.id,
      role: user.role,
      facultyId: user.facultyId,
      isImpersonating: user.isImpersonating,
      realUserId: user.realUserId,
    },
    input: {
      targetRole: typeof body.targetRole === "string" ? body.targetRole : undefined,
      facultyId: typeof body.facultyId === "string" ? body.facultyId : undefined,
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const linkId = searchParams.get("id");
  if (!linkId) return NextResponse.json({ success: false, error: "id obrigatório" }, { status: 400 });

  const result = await executeDeactivateInviteLink({
    actor: {
      id: user.id,
      role: user.role,
      facultyId: user.facultyId,
      isImpersonating: user.isImpersonating,
      realUserId: user.realUserId,
    },
    linkId,
  });

  return NextResponse.json(result.body, { status: result.status });
}
