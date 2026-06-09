import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
  authorizeSwapSchema,
  executeAuthorizeSwap,
} from "@/features/requests/application/use-cases/authorize-swap";

/* ═══════════ POST — preceptor authorizes/rejects a swap ═══════════ */

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["PRECEPTOR", "COORDINATOR"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = authorizeSwapSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const result = await executeAuthorizeSwap({
    actor: {
      id: user.id,
      role: user.role,
      realUserId: user.realUserId,
    },
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}
