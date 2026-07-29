/**
 * Sorteio de escala pela tela do admin — exclusivo da instância Vitalmed
 * (feature "adminLottery"). No SAMU o sorteio é do líder, e esta rota responde
 * 404.
 *
 * Reaproveita o mesmo motor do sorteio do líder: a diferença é só quem manda e
 * o fato de o admin precisar dizer qual faculdade, já que não é vinculado a
 * nenhuma.
 */

import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { bloqueioDeFeature } from "@/lib/feature-gate";
import {
  executeRunLeaderLottery,
  runLeaderLotterySchema,
} from "@/features/scheduling/application/use-cases/run-leader-lottery";

export async function POST(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("adminLottery");
  if (bloqueio) return bloqueio;

  const user = await getEffectiveUser(req);
  if (!user || user.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = runLeaderLotterySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }
  if (!parsed.data.facultyId) {
    return NextResponse.json({ success: false, error: "Selecione a faculdade" }, { status: 400 });
  }

  const result = await executeRunLeaderLottery({
    actor: {
      id: user.id,
      role: user.role,
      facultyId: null, // o admin não tem faculdade; ela vem no corpo
      isImpersonating: user.isImpersonating,
      realUserId: user.realUserId,
    },
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}
