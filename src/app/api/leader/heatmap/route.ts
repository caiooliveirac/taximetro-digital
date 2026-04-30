import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { generateAdminReport } from "@/lib/admin-report-builder";
import { z } from "zod";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "LEADER") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const parsed = querySchema.safeParse({ from: searchParams.get("from"), to: searchParams.get("to") });
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Parâmetros inválidos" }, { status: 400 });
  }

  const facultyId = token.facultyId as string | null;
  if (!facultyId) {
    return NextResponse.json({ success: false, error: "Líder sem faculdade configurada" }, { status: 400 });
  }

  const cohortId = (token as Record<string, unknown>).cohortId as string | null;
  const { from, to } = parsed.data;

  const { document } = await generateAdminReport({
    from,
    to,
    facultyId,
    scopeMode: cohortId ? "COHORT" : "ALL_FACULTY",
    cohortGrouping: "NAMED_COHORT",
    selectedCohorts: cohortId ? [cohortId] : [],
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
