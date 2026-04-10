import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { executeListSwapHistory } from "@/features/requests/application/use-cases/list-swap-history";

/* ═══════════ GET — swap history with full tracking ═══════════ */

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const data = await executeListSwapHistory({
    actor: {
      id: user.id,
      role: user.role,
      facultyId: user.facultyId,
    },
    internId: searchParams.get("internId"),
    selfOnly: searchParams.get("selfOnly") === "true",
  });

  return NextResponse.json({ success: true, data });
}
