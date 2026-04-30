import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { db } from "@/db";
import { cohorts } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actor = await getEffectiveUser(req);
  if (!actor || actor.role !== "LEADER") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  if (!actor.cohortId) {
    return NextResponse.json({ success: true, data: null });
  }

  const [cohort] = await db
    .select({ startDate: cohorts.startDate, endDate: cohorts.endDate, label: cohorts.label })
    .from(cohorts)
    .where(eq(cohorts.id, actor.cohortId))
    .limit(1);

  return NextResponse.json({ success: true, data: cohort ?? null });
}
