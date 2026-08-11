import { NextRequest, NextResponse } from "next/server";
import { executeAbsenceSweep } from "@/features/admin-attendance/application/use-cases/sweep-absences";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  return Boolean(process.env.AUTH_SECRET) && key === process.env.AUTH_SECRET;
}

/**
 * Job diário: marca como ABSENT os plantões de dias anteriores que não
 * tiveram checkout (checkout é a medida de presença). Disparado pelo cron
 * do container — ver scripts/container-entrypoint.sh.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const result = await executeAbsenceSweep();

  return NextResponse.json({ success: true, ...result });
}
