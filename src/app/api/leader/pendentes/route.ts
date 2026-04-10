import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
  executeListPendingUsers,
} from "@/features/user-management/application/use-cases/list-pending-users";
import {
  executeReviewPendingUser,
  reviewPendingUserSchema,
} from "@/features/user-management/application/use-cases/review-pending-user";

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const filtered = await executeListPendingUsers({
    role: user.role,
    facultyId: user.facultyId,
  });

  return NextResponse.json({ success: true, data: filtered });
}

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = reviewPendingUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const result = await executeReviewPendingUser({
    actor: {
      id: user.id,
      role: user.role,
      facultyId: user.facultyId,
      realUserId: user.realUserId,
    },
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}
