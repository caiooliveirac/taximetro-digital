import { NextRequest, NextResponse } from "next/server";
import { executeAutoReleaseSlots } from "@/features/scheduling/application/use-cases/auto-release-slots";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  return Boolean(process.env.AUTH_SECRET) && key === process.env.AUTH_SECRET;
}

/**
 * Job de hora em hora: vaga da grade não usada no prazo da turma e vaga sem
 * dono viram vaga livre para os líderes. Disparado pelo cron do container —
 * ver scripts/container-entrypoint.sh.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const result = await executeAutoReleaseSlots();
  return NextResponse.json({ success: true, ...result });
}
