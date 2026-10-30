/**
 * Agenda acadêmica da turma do líder (ver academic-commitments.ts).
 * GET lista turmas e compromissos; POST lança (ou pré-visualiza); DELETE ?id apaga.
 */

import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
  createCommitmentSchema,
  executeCancelCommitment,
  executeCreateCommitment,
  executeListCommitments,
} from "@/features/scheduling/application/use-cases/academic-commitments";

export const dynamic = "force-dynamic";

async function ator(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return null;
  return {
    id: user.id,
    role: user.role,
    facultyId: user.facultyId,
    cohortId: user.cohortId,
    isImpersonating: user.isImpersonating,
    realUserId: user.realUserId,
  };
}

const semPermissao = () => NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

export async function GET(req: NextRequest) {
  const actor = await ator(req);
  if (!actor) return semPermissao();
  const result = await executeListCommitments({ actor, input: {} });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: NextRequest) {
  const actor = await ator(req);
  if (!actor) return semPermissao();
  const parsed = createCommitmentSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  // O líder nunca escolhe faculdade (ver escala-scope.ts).
  const result = await executeCreateCommitment({ actor, input: { ...parsed.data, facultyId: undefined } });
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(req: NextRequest) {
  const actor = await ator(req);
  if (!actor) return semPermissao();
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const result = await executeCancelCommitment({ actor, input: { id } });
  return NextResponse.json(result.body, { status: result.status });
}
