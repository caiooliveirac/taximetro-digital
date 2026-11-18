/**
 * POST /api/intern/mudar-de-base { assignmentId, offerId } — o interno troca
 * a base de um plantão que ainda não começou por uma vaga livre do mesmo dia e
 * turno. Regras em mudar-de-base-do-interno.ts. Quem personifica não muda
 * plantão de ninguém.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEffectiveUser } from "@/lib/impersonate";
import { executeMudarDeBase } from "@/features/scheduling/application/use-cases/mudar-de-base-do-interno";
import { checkRateLimit } from "@/shared/infra/rate-limit";

const pedido = z.object({ assignmentId: z.string().uuid(), offerId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || (user.role !== "INTERN" && user.role !== "LEADER")) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  if (user.isImpersonating) {
    return NextResponse.json({ success: false, error: "Personificando: só o próprio interno muda a base do plantão dele." }, { status: 403 });
  }
  const parsed = pedido.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Pedido inválido." }, { status: 400 });
  if (!checkRateLimit(`mudar-de-base:${user.id}`, 10, 24 * 60 * 60_000)) {
    return NextResponse.json({ success: false, error: "Muitas mudanças hoje. Fale com o seu líder." }, { status: 429 });
  }

  const r = await executeMudarDeBase({ internId: user.id, ...parsed.data });
  return NextResponse.json(r.body, { status: r.status });
}
