/**
 * Troca a três (roda): POST propõe, PATCH confirma, recusa ou cancela.
 * Regras em src/shared/domain/policies/swap-cycle-policy.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEffectiveUser } from "@/lib/impersonate";
import { bloqueioDeFeature } from "@/lib/feature-gate";
import { proporRoda, responderRoda } from "@/features/requests/application/use-cases/swap-cycle";

const postSchema = z.object({
  assignmentIds: z.array(z.string().uuid()).length(3),
  qualquerSentido: z.boolean().optional(),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  acao: z.enum(["confirmar", "recusar", "cancelar"]),
});

export async function POST(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("sinaisDeTroca");
  if (bloqueio) return bloqueio;
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });

  const r = await proporRoda({ ator: { id: user.id, realUserId: user.realUserId ?? null }, ...parsed.data });
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("sinaisDeTroca");
  if (bloqueio) return bloqueio;
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });

  const r = await responderRoda({ ator: { id: user.id, realUserId: user.realUserId ?? null }, ...parsed.data });
  return NextResponse.json(r.body, { status: r.status });
}
