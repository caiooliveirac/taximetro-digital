/**
 * Sorteio de intervenção pela tela de montar escala do coordenador.
 *
 * Mesmo motor do sorteio do líder (`executeRunLeaderLottery`), que já sabe pegar
 * a faculdade do corpo quando quem chama é COORDINATOR.
 *
 * Não confundir com `/api/admin/lottery`: aquela serve o botão "Sortear escala"
 * da tela de Escala USA, exclusivo da Vitalmed (feature `adminLottery`), que
 * sorteia a faculdade inteira de uma vez sem escolher quem entra. Esta serve a
 * tela completa, existe nas duas instâncias, e recebe a lista de internos já
 * recortada por turma.
 */

import { NextRequest, NextResponse } from "next/server";
import { escopoDoAdminNaEscala } from "@/lib/admin-escala";
import {
  executeRunLeaderLottery,
  runLeaderLotterySchema,
} from "@/features/scheduling/application/use-cases/run-leader-lottery";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const escopo = await escopoDoAdminNaEscala(req, body?.facultyId);
  if (!escopo.ok) return escopo.resposta;

  const parsed = runLeaderLotterySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const result = await executeRunLeaderLottery({
    actor: {
      id: escopo.actor.id,
      role: escopo.actor.role,
      facultyId: null, // o coordenador não tem faculdade; ela vem no corpo
      isImpersonating: escopo.actor.isImpersonating,
      realUserId: escopo.actor.realUserId,
    },
    input: { ...parsed.data, facultyId: escopo.actor.facultyId },
  });

  return NextResponse.json(result.body, { status: result.status });
}
