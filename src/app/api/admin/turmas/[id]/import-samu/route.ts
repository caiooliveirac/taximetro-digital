import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { z } from "zod/v4";
import { ORG } from "@/lib/instance";
import { executeImportFromSamu } from "@/features/cohorts/application/use-cases/import-from-samu";

const bodySchema = z.object({ samuCohortId: z.string().uuid() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (ORG !== "vitalmed") {
    return NextResponse.json({ success: false, error: "Não encontrado" }, { status: 404 });
  }

  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const result = await executeImportFromSamu({ cohortId: id, samuCohortId: parsed.data.samuCohortId });
  return NextResponse.json(result.body, { status: result.status });
}
