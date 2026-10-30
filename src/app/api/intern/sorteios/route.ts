/**
 * /api/intern/sorteios — sorteio da repescagem (sorteio-repescagem.ts).
 *
 * GET    → { proximos, resultados }: turnos com vaga livre, hora do sorteio,
 *          inscritos (públicos) e resultados recentes com a semente
 * POST   → { date, period } inscreve quem chama
 * DELETE → { date, period } desiste
 *
 * Interno ou líder. Coordenador personificando vê, mas não inscreve ninguém.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEffectiveUser } from "@/lib/impersonate";
import { desistir, inscrever, painelDosSorteios } from "@/features/extra-offers/application/sorteio-repescagem";

const turno = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), period: z.enum(["DAY", "NIGHT"]) });

async function quem(req: NextRequest) {
  const user = await getEffectiveUser(req);
  return user && (user.role === "INTERN" || user.role === "LEADER") ? user : null;
}

export async function GET(req: NextRequest) {
  const user = await quem(req);
  if (!user) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  return NextResponse.json({ success: true, data: await painelDosSorteios(user.id) });
}

async function mudar(req: NextRequest, acao: typeof inscrever) {
  const user = await quem(req);
  if (!user) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  if (user.isImpersonating) return NextResponse.json({ success: false, error: "Personificando: só olhar." }, { status: 403 });
  const parsed = turno.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Turno inválido." }, { status: 400 });
  const r = await acao(user.id, parsed.data.date, parsed.data.period);
  return r.ok ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: r.erro }, { status: 409 });
}

export const POST = (req: NextRequest) => mudar(req, inscrever);
export const DELETE = (req: NextRequest) => mudar(req, desistir);
