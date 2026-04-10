import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { executeRunLeaderLottery, runLeaderLotterySchema } from "@/features/scheduling/application/use-cases/run-leader-lottery";

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = runLeaderLotterySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const result = await executeRunLeaderLottery({
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
