/**
 * Agenda acadêmica pela tela de montar escala do coordenador. Mesmos casos de
 * uso da rota do líder; a faculdade vem da tela (ver admin-escala.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { escopoDoAdminNaEscala } from "@/lib/admin-escala";
import {
  createCommitmentSchema,
  executeCancelCommitment,
  executeCreateCommitment,
  executeListCommitments,
} from "@/features/scheduling/application/use-cases/academic-commitments";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const escopo = await escopoDoAdminNaEscala(req, req.nextUrl.searchParams.get("facultyId"));
  if (!escopo.ok) return escopo.resposta;
  const result = await executeListCommitments({ actor: escopo.actor, input: {} });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const escopo = await escopoDoAdminNaEscala(req, body?.facultyId);
  if (!escopo.ok) return escopo.resposta;
  const parsed = createCommitmentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  const result = await executeCreateCommitment({
    actor: escopo.actor,
    input: { ...parsed.data, facultyId: escopo.actor.facultyId },
  });
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(req: NextRequest) {
  const escopo = await escopoDoAdminNaEscala(req, req.nextUrl.searchParams.get("facultyId"));
  if (!escopo.ok) return escopo.resposta;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const result = await executeCancelCommitment({ actor: escopo.actor, input: { id, facultyId: escopo.actor.facultyId } });
  return NextResponse.json(result.body, { status: result.status });
}
