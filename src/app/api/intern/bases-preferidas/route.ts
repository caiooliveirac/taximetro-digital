/**
 * Bases favoritas e a evitar do interno: até 3 de cada. Só reordenam o
 * mercado de trocas (swap-match-policy.ts). Cada um lê e grava só as suas.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEffectiveUser } from "@/lib/impersonate";
import { bloqueioDeFeature } from "@/lib/feature-gate";
import {
  basesDeAmbulancia,
  gravarPreferencia,
  preferenciasDoInterno,
} from "@/features/requests/infra/repositories/swap-market-repository";

const LIMITE = 3;

export async function GET(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("sinaisDeTroca");
  if (bloqueio) return bloqueio;
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const [bases, preferencias] = await Promise.all([basesDeAmbulancia(), preferenciasDoInterno(user.id)]);
  return NextResponse.json({ success: true, data: { bases, preferencias } });
}

const putSchema = z.object({
  baseId: z.string().uuid(),
  // 1 favorita, -1 evitar, 0 tira a preferência.
  peso: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});

export async function PUT(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("sinaisDeTroca");
  if (bloqueio) return bloqueio;
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  const { baseId, peso } = parsed.data;

  const [bases, atuais] = await Promise.all([basesDeAmbulancia(), preferenciasDoInterno(user.id)]);
  if (!bases.some((b) => b.id === baseId)) {
    return NextResponse.json({ success: false, error: "Só dá para escolher base de ambulância." }, { status: 400 });
  }
  if (peso !== 0) {
    const mesmoPeso = atuais.filter((p) => p.peso === peso && p.baseId !== baseId).length;
    if (mesmoPeso >= LIMITE) {
      const tipo = peso > 0 ? "favoritas" : "a evitar";
      return NextResponse.json({ success: false, error: `No máximo ${LIMITE} bases ${tipo}. Tire uma antes.` }, { status: 409 });
    }
  }

  await gravarPreferencia({ internId: user.id, baseId, peso });
  return NextResponse.json({ success: true });
}
