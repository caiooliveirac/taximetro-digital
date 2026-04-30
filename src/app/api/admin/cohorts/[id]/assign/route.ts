import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  executeBulkAssignCohort,
  executeUnassignCohort,
} from "@/features/cohorts/application/use-cases/manage-cohorts";

async function requireCoordinator(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "COORDINATOR") return null;
  return token;
}

// POST /api/admin/cohorts/:id/assign — bulk assign interns to cohort
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const userRoleIds: string[] = Array.isArray(body.userRoleIds) ? body.userRoleIds : [];

  const result = await executeBulkAssignCohort({
    actorUserId: token.id as string,
    cohortId: id,
    userRoleIds,
  });
  return NextResponse.json(result.body, { status: result.status });
}

// DELETE /api/admin/cohorts/:id/assign — unassign a single intern
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  if (!body.userRoleId) return NextResponse.json({ success: false, error: "userRoleId obrigatório" }, { status: 400 });

  const result = await executeUnassignCohort({
    actorUserId: token.id as string,
    cohortId: id,
    userRoleId: body.userRoleId,
  });
  return NextResponse.json(result.body, { status: result.status });
}
