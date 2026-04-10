import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { executeListPreceptorBases } from "@/features/bases/application/use-cases/list-preceptor-bases";

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["PRECEPTOR", "COORDINATOR"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const rows = await executeListPreceptorBases();

  return NextResponse.json({ success: true, data: rows });
}
