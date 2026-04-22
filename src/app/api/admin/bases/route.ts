import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  adminBaseSchema,
  executeCreateBase,
  executeListAdminBases,
  executeUpdateBase,
} from "@/features/bases/application/use-cases/manage-admin-bases";

async function requireCoordinator(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "COORDINATOR") return null;
  return token;
}

export async function GET() {
  const rows = await executeListAdminBases();
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const body = await req.json();
  const parsed = adminBaseSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const result = await executeCreateBase({
    actorUserId: token.id as string,
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}

export async function PUT(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const body = await req.json();
  const { id, ...rest } = body;
  if (!id) return NextResponse.json({ success: false, error: "ID obrigatório" }, { status: 400 });

  const parsed = adminBaseSchema.partial().safeParse(rest);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const result = await executeUpdateBase({
    actorUserId: token.id as string,
    baseId: id,
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}
