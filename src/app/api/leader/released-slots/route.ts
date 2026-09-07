/**
 * Vagas liberadas pela faculdade do líder (ver release-slots.ts).
 * GET ?from&to lista; POST libera (dia/turno inteiro ou uma base); DELETE desfaz.
 */

import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
  executeListReleased,
  executeReleaseSlots,
  executeUndoRelease,
  releaseSlotsSchema,
  undoReleaseSchema,
} from "@/features/scheduling/application/use-cases/release-slots";

export const dynamic = "force-dynamic";

async function ator(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return null;
  return {
    id: user.id,
    role: user.role,
    facultyId: user.facultyId,
    isImpersonating: user.isImpersonating,
    realUserId: user.realUserId,
  };
}

const semPermissao = () => NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

export async function GET(req: NextRequest) {
  const actor = await ator(req);
  if (!actor) return semPermissao();
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  const result = await executeListReleased({ actor, input: { from, to } });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: NextRequest) {
  const actor = await ator(req);
  if (!actor) return semPermissao();
  const parsed = releaseSlotsSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  }
  const result = await executeReleaseSlots({ actor, input: parsed.data });
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(req: NextRequest) {
  const actor = await ator(req);
  if (!actor) return semPermissao();
  const parsed = undoReleaseSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  }
  const result = await executeUndoRelease({ actor, input: parsed.data });
  return NextResponse.json(result.body, { status: result.status });
}
