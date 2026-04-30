import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  executeCreateSlotRule,
  executeDeleteSlotRule,
  executeListSlotRules,
  executeUpdateSlotRule,
  slotRuleSchema,
} from "@/features/slot-rules/application/use-cases/manage-slot-rules";

async function requireCoordinator(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "COORDINATOR") return null;
  return token;
}

export async function GET() {
  const rows = await executeListSlotRules();

  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const body = await req.json();
  const parsed = slotRuleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const result = await executeCreateSlotRule({
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

  const parsed = slotRuleSchema.partial().safeParse(rest);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const result = await executeUpdateSlotRule({
    actorUserId: token.id as string,
    ruleId: id,
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: "ID obrigatório" }, { status: 400 });

  const result = await executeDeleteSlotRule({
    actorUserId: token.id as string,
    ruleId: id,
  });

  return NextResponse.json(result.body, { status: result.status });
}
