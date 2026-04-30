import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  cohortUpdateSchema,
  executeGetCohort,
  executeUpdateCohort,
  executeDeleteCohort,
} from "@/features/cohorts/application/use-cases/manage-cohorts";

async function requireCoordinator(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "COORDINATOR") return null;
  return token;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cohort = await executeGetCohort(id);
  if (!cohort) return NextResponse.json({ success: false, error: "Turma não encontrada" }, { status: 404 });
  return NextResponse.json({ success: true, data: cohort });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const parsed = cohortUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const result = await executeUpdateCohort({ actorUserId: token.id as string, cohortId: id, input: parsed.data });
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const { id } = await params;
  const result = await executeDeleteCohort({ actorUserId: token.id as string, cohortId: id });
  return NextResponse.json(result.body, { status: result.status });
}
