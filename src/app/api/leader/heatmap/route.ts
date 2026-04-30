import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { generateAdminReport } from "@/lib/admin-report-builder";
import { z } from "zod";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(req: NextRequest) {
  const actor = await getEffectiveUser(req);
  if (!actor || actor.role !== "LEADER") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const parsed = querySchema.safeParse({ from: searchParams.get("from"), to: searchParams.get("to") });
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Parâmetros inválidos" }, { status: 400 });
  }

  if (!actor.facultyId) {
    return NextResponse.json({ success: false, error: "Líder sem faculdade configurada" }, { status: 400 });
  }

  const { from, to } = parsed.data;

  const { document } = await generateAdminReport({
    from,
    to,
    facultyId: actor.facultyId,
    scopeMode: actor.cohortId ? "COHORT" : "ALL_FACULTY",
    cohortGrouping: "NAMED_COHORT",
    selectedCohorts: actor.cohortId ? [actor.cohortId] : [],
    selectedInternIds: [],
    performance: {
      belowHoursTarget: false,
      belowShiftsTarget: false,
      hasAbsences: false,
      moreThanNAbsences: false,
      absencesThreshold: 2,
      hasPendingRequests: false,
      hasRejectedRequests: false,
      aboveTarget: false,
      noCheckinInPeriod: false,
    },
    content: {
      summary: true,
      completed: true,
      scheduled: true,
      absences: true,
      caseRecords: false,
      requestHistory: false,
      progress: false,
    },
    orderBy: "ALPHABETICAL",
    display: {
      compactCompleted: false,
      hideEmptySections: true,
      includeCover: true,
      compareCohorts: false,
      showHeatmap: true,
    },
  });

  return NextResponse.json({ success: true, data: document }, { headers: { "cache-control": "no-store" } });
}
