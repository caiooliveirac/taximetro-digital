import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  executeGetCohort,
  executeListInternsByCohort,
  executeListInternsWithoutCohort,
} from "@/features/cohorts/application/use-cases/manage-cohorts";

async function requireCoordinator(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "COORDINATOR") return null;
  return token;
}

// GET /api/admin/cohorts/:id/interns?mode=assigned|unassigned
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const { id } = await params;
  const cohort = await executeGetCohort(id);
  if (!cohort) return NextResponse.json({ success: false, error: "Turma não encontrada" }, { status: 404 });

  const mode = req.nextUrl.searchParams.get("mode") ?? "assigned";

  const data = mode === "unassigned"
    ? await executeListInternsWithoutCohort(cohort.facultyId)
    : await executeListInternsByCohort(id);

  return NextResponse.json({ success: true, data });
}
