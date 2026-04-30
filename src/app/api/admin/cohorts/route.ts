import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  cohortCreateSchema,
  executeListCohorts,
  executeCreateCohort,
} from "@/features/cohorts/application/use-cases/manage-cohorts";

async function requireCoordinator(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "COORDINATOR") return null;
  return token;
}

export async function GET(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const facultyId = searchParams.get("facultyId") ?? undefined;
  const statusParam = searchParams.getAll("status") as ("PLANNED" | "ACTIVE" | "CLOSED")[];

  const data = await executeListCohorts({
    facultyId,
    status: statusParam.length > 0 ? statusParam : undefined,
  });

  return NextResponse.json({ success: true, data });
}

export async function POST(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const body = await req.json();
  const parsed = cohortCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const result = await executeCreateCohort({ actorUserId: token.id as string, input: parsed.data });
  return NextResponse.json(result.body, { status: result.status });
}
