/**
 * Materializa os plantões do CRU fixo da semana, na faculdade escolhida pelo
 * coordenador. Mesmo caso de uso da rota do líder (`/api/leader/cru-generate`).
 */

import { NextRequest, NextResponse } from "next/server";
import { escopoDoAdminNaEscala } from "@/lib/admin-escala";
import {
  executeGenerateCruFixedWeek,
  generateCruFixedWeekSchema,
} from "@/features/scheduling/application/use-cases/generate-cru-fixed-week";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const escopo = await escopoDoAdminNaEscala(req, body?.facultyId);
  if (!escopo.ok) return escopo.resposta;

  const parsed = generateCruFixedWeekSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Data inválida" }, { status: 400 });
  }

  const result = await executeGenerateCruFixedWeek({ actor: escopo.actor, input: parsed.data });
  return NextResponse.json(result.body, { status: result.status });
}
