/**
 * Internos da faculdade escolhida, para a tela de montar escala do coordenador.
 *
 * Mesmo caso de uso da rota do líder (`/api/leader/interns`); a faculdade é que
 * vem da tela em vez do vínculo. Sem `cohortId`: o coordenador recebe todas as
 * turmas da faculdade e recorta a turma no seletor do sorteio.
 */

import { NextRequest, NextResponse } from "next/server";
import { escopoDoAdminNaEscala } from "@/lib/admin-escala";
import { executeListFacultyInterns } from "@/features/user-management/application/use-cases/list-faculty-interns";
import {
  executeUpdateInternStatus,
  updateInternStatusSchema,
} from "@/features/user-management/application/use-cases/update-intern-status";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const escopo = await escopoDoAdminNaEscala(req, req.nextUrl.searchParams.get("facultyId"));
  if (!escopo.ok) return escopo.resposta;

  const data = await executeListFacultyInterns(escopo.actor.facultyId, null);
  return NextResponse.json({ success: true, data });
}

/** PATCH — desativa/reativa o vínculo do interno na faculdade escolhida. */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const escopo = await escopoDoAdminNaEscala(req, body?.facultyId);
  if (!escopo.ok) return escopo.resposta;

  const parsed = updateInternStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const result = await executeUpdateInternStatus({
    actor: {
      id: escopo.actor.id,
      facultyId: escopo.actor.facultyId,
      isImpersonating: escopo.actor.isImpersonating,
      realUserId: escopo.actor.realUserId,
    },
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}
