import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
  createCaseRecordSchema,
  executeCreateCaseRecord,
} from "@/features/case-records/application/use-cases/create-case-record";
import { executeListCaseRecords } from "@/features/case-records/application/use-cases/list-case-records";

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const filtered = await executeListCaseRecords({
    id: user.id,
    role: user.role,
  });

  return NextResponse.json({ success: true, data: filtered });
}

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  const parsed = createCaseRecordSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const result = await executeCreateCaseRecord({
    actorId: user.id,
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}
