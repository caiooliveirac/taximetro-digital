/**
 * Sinais do interno no calendário: outro serviço, Quero e Posso.
 *
 * Cada um lê e grava só os próprios (impersonação conta como a pessoa). Ninguém
 * mais vê estes dados por aqui: o que for para as trocas sai agregado.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEffectiveUser } from "@/lib/impersonate";
import { bloqueioDeFeature } from "@/lib/feature-gate";
import { addDaysToDateStr, localDateStr } from "@/lib/utils";
import { SINAIS_DO_DIA, motivoParaRecusarSinal } from "@/shared/domain/policies/day-signal-policy";
import {
  apagarSinal,
  gravarSinal,
  listarSinais,
  plantoesDoInternoEntre,
} from "@/features/scheduling/infra/repositories/day-signal-repository";

/** Até onde dá para marcar: o rodízio inteiro cabe com folga. */
const HORIZONTE_DIAS = 120;

export async function GET(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("sinaisDeTroca");
  if (bloqueio) return bloqueio;

  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const data = await listarSinais({ internId: user.id, dateFrom: addDaysToDateStr(localDateStr(), -60) });
  return NextResponse.json({ success: true, data });
}

const putSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.enum(["DAY", "NIGHT"]),
  // null apaga o sinal do turno.
  signal: z.enum(SINAIS_DO_DIA).nullable(),
  label: z.string().trim().max(60).optional(),
});

export async function PUT(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("sinaisDeTroca");
  if (bloqueio) return bloqueio;

  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  const { date, period, signal, label } = parsed.data;

  const hoje = localDateStr();
  if (date < hoje) {
    return NextResponse.json({ success: false, error: "Não dá para marcar um dia que já passou." }, { status: 400 });
  }
  if (date > addDaysToDateStr(hoje, HORIZONTE_DIAS)) {
    return NextResponse.json({ success: false, error: "Dá para marcar até 120 dias à frente." }, { status: 400 });
  }

  if (signal === null) {
    await apagarSinal({ internId: user.id, date, period });
    return NextResponse.json({ success: true });
  }

  if (signal !== "OUTRO_SERVICO") {
    const [plantoes, sinais] = await Promise.all([
      plantoesDoInternoEntre({ internId: user.id, dateFrom: addDaysToDateStr(date, -1), dateTo: addDaysToDateStr(date, 1) }),
      listarSinais({ internId: user.id, dateFrom: addDaysToDateStr(date, -1), dateTo: addDaysToDateStr(date, 1) }),
    ]);
    const motivo = motivoParaRecusarSinal({ signal, turno: { date, period }, plantoes, sinais });
    if (motivo) return NextResponse.json({ success: false, error: motivo }, { status: 409 });
  }

  await gravarSinal({
    internId: user.id,
    date,
    period,
    signal,
    label: signal === "OUTRO_SERVICO" ? label || null : null,
  });
  return NextResponse.json({ success: true });
}
