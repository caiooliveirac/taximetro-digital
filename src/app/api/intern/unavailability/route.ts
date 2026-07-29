/**
 * Indisponibilidade do interno — exclusiva da instância Vitalmed.
 *
 * A primeira coisa em cada handler é o bloqueio de instância: numa instalação
 * onde a feature não existe, estas rotas respondem 404, e não 403 — não há por
 * que confirmar que elas existem em outro lugar.
 */

import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { bloqueioDeFeature } from "@/lib/feature-gate";
import {
  executeSaveUnavailability,
  saveUnavailabilitySchema,
} from "@/features/scheduling/application/use-cases/save-unavailability";
import { listarPorInterno } from "@/features/scheduling/infra/repositories/unavailability-repository";
import { datasDaSemana } from "@/shared/domain/policies/unavailability-policy";

export async function GET(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("internUnavailability");
  if (bloqueio) return bloqueio;

  const user = await getEffectiveUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const weekStart = req.nextUrl.searchParams.get("weekStart");
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ success: false, error: "weekStart inválido" }, { status: 400 });
  }

  // Só o COORDINATOR pode olhar a semana de outra pessoa.
  const alvo = req.nextUrl.searchParams.get("internId");
  if (alvo && alvo !== user.id && user.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const semana = datasDaSemana(weekStart);
  const itens = await listarPorInterno({
    internId: alvo ?? user.id,
    dateFrom: semana[0],
    dateTo: semana[6],
  });

  return NextResponse.json({ success: true, data: { weekStart: semana[0], itens } });
}

export async function PUT(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("internUnavailability");
  if (bloqueio) return bloqueio;

  const user = await getEffectiveUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = saveUnavailabilitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const resultado = await executeSaveUnavailability({
    actor: {
      id: user.id,
      role: user.role,
      isImpersonating: user.isImpersonating,
      realUserId: user.realUserId,
    },
    input: parsed.data,
  });

  return NextResponse.json(resultado.body, { status: resultado.status });
}
