/**
 * Vagas liberadas pela tela de montar escala do coordenador. Mesmos casos de
 * uso da rota do líder; a faculdade vem da tela (ver admin-escala.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { escopoDoAdminNaEscala } from "@/lib/admin-escala";
import {
  executeListFreeSlots,
  executeListReleased,
  executeReleaseSlots,
  executeUndoRelease,
  releaseSlotsSchema,
  undoReleaseSchema,
} from "@/features/scheduling/application/use-cases/release-slots";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const escopo = await escopoDoAdminNaEscala(req, req.nextUrl.searchParams.get("facultyId"));
  if (!escopo.ok) return escopo.resposta;
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  const livres = req.nextUrl.searchParams.get("free") === "1";
  const result = livres
    ? await executeListFreeSlots({ actor: escopo.actor, input: { from, to } })
    : await executeListReleased({ actor: escopo.actor, input: { from, to } });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const escopo = await escopoDoAdminNaEscala(req, body?.facultyId);
  if (!escopo.ok) return escopo.resposta;
  const parsed = releaseSlotsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  }
  const result = await executeReleaseSlots({
    actor: escopo.actor,
    input: { ...parsed.data, facultyId: escopo.actor.facultyId },
  });
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(req: NextRequest) {
  const escopo = await escopoDoAdminNaEscala(req, req.nextUrl.searchParams.get("facultyId"));
  if (!escopo.ok) return escopo.resposta;
  const parsed = undoReleaseSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  }
  const result = await executeUndoRelease({
    actor: escopo.actor,
    input: { ...parsed.data, facultyId: escopo.actor.facultyId },
  });
  return NextResponse.json(result.body, { status: result.status });
}
