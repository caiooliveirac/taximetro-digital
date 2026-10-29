/**
 * POST /api/intern/vagas-livres/candidatura { offerId } — o interno se
 * candidata a uma vaga livre; a coordenação decide. Regras em
 * candidatar-vaga-livre.ts. Quem personifica não candidata ninguém.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEffectiveUser } from "@/lib/impersonate";
import { executeCandidatarVagaLivre } from "@/features/extra-offers/application/use-cases/candidatar-vaga-livre";
import { checkRateLimit } from "@/shared/infra/rate-limit";

const pedido = z.object({ offerId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || (user.role !== "INTERN" && user.role !== "LEADER")) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  if (user.isImpersonating) {
    return NextResponse.json({ success: false, error: "Personificando: a candidatura é do próprio interno." }, { status: 403 });
  }
  const parsed = pedido.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Pedido inválido." }, { status: 400 });
  if (!checkRateLimit(`candidatura:${user.id}`, 20, 24 * 60 * 60_000)) {
    return NextResponse.json({ success: false, error: "Muitas candidaturas hoje." }, { status: 429 });
  }

  const r = await executeCandidatarVagaLivre({
    intern: { id: user.id, facultyId: user.facultyId },
    offerId: parsed.data.offerId,
  });
  return NextResponse.json(r.body, { status: r.status });
}
