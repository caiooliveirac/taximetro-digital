import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
  executeReviewPendingPhotoChangeRequest,
  reviewPendingPhotoChangeRequestSchema,
} from "@/features/user-management/application/use-cases/review-pending-photo-change-request";

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = reviewPendingPhotoChangeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const result = await executeReviewPendingPhotoChangeRequest({
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