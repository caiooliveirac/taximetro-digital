/**
 * Mercado de trocas do interno: ofertas abertas separadas pelo que resolvem
 * para ele, resumo das ofertas dele e janela de oferta × procura.
 * Regras em src/shared/domain/policies/swap-match-policy.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { bloqueioDeFeature } from "@/lib/feature-gate";
import { executeGetSwapMarket } from "@/features/requests/application/use-cases/get-swap-market";

export async function GET(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("sinaisDeTroca");
  if (bloqueio) return bloqueio;

  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const data = await executeGetSwapMarket({ internId: user.id, facultyId: user.facultyId ?? null });
  return NextResponse.json({ success: true, data });
}
