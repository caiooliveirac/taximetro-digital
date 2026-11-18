/**
 * POST /api/intern/sem-checkout { assignmentId, preceptor } — o interno conta
 * que o preceptor saiu sem fazer o checkout dele. Regras em
 * registrar-sem-checkout.ts. Quem personifica não registra por ninguém.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEffectiveUser } from "@/lib/impersonate";
import { executeRegistrarSemCheckout } from "@/features/scheduling/application/use-cases/registrar-sem-checkout";
import { checkRateLimit } from "@/shared/infra/rate-limit";

const pedido = z.object({ assignmentId: z.string().uuid(), preceptor: z.string().max(120) });

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || (user.role !== "INTERN" && user.role !== "LEADER")) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  if (user.isImpersonating) {
    return NextResponse.json({ success: false, error: "Personificando: só o próprio interno registra." }, { status: 403 });
  }
  const parsed = pedido.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Pedido inválido." }, { status: 400 });
  if (!checkRateLimit(`sem-checkout:${user.id}`, 10, 24 * 60 * 60_000)) {
    return NextResponse.json({ success: false, error: "Muitos registros hoje. Fale com o seu líder." }, { status: 429 });
  }

  const r = await executeRegistrarSemCheckout({ internId: user.id, assignmentId: parsed.data.assignmentId, preceptor: parsed.data.preceptor });
  return NextResponse.json(r.body, { status: r.status });
}
