import { NextRequest, NextResponse } from "next/server";
import { evaluateCohortLifecycle } from "@/features/cohorts/application/use-cases/cohort-lifecycle";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  return Boolean(process.env.AUTH_SECRET) && key === process.env.AUTH_SECRET;
}

/**
 * Job diário: avalia as datas de início/fim de todas as turmas e aplica
 * as transições de status (PLANNED → ACTIVE → CLOSED + arquivamento).
 * Disparado pelo cron do container — ver scripts/container-entrypoint.sh.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const result = await evaluateCohortLifecycle({ actorUserId: null });

  return NextResponse.json({ success: true, ...result });
}
