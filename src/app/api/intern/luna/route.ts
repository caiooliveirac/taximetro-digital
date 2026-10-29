/**
 * /api/intern/luna — pergunta à Luna (ver src/lib/luna-interno.ts).
 *
 * GET  → { ligada } (sem OPENAI_API_KEY a tela mostra só os atalhos)
 * POST → { mensagens: [{ role, content }] } → { texto, cartoes }
 *
 * Teto por pessoa: 40 perguntas por dia e uma de cada vez — custo do modelo.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEffectiveUser } from "@/lib/impersonate";
import { lunaLigada, perguntarLuna } from "@/lib/luna-interno";
import { checkRateLimit } from "@/shared/infra/rate-limit";
import { localDateStr } from "@/lib/utils";

const pedido = z.object({
  mensagens: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(20),
});

// ponytail: memória do processo, como o rate-limit; uma réplica só.
const emCurso = new Set<string>();

async function quem(req: NextRequest) {
  const user = await getEffectiveUser(req);
  return user && (user.role === "INTERN" || user.role === "LEADER") ? user : null;
}

export async function GET(req: NextRequest) {
  if (!(await quem(req))) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  return NextResponse.json({ success: true, data: { ligada: lunaLigada() } });
}

export async function POST(req: NextRequest) {
  const user = await quem(req);
  if (!user) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  if (!lunaLigada()) return NextResponse.json({ success: false, error: "A Luna está desligada no momento." }, { status: 503 });

  const parsed = pedido.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.mensagens.at(-1)?.role !== "user") {
    return NextResponse.json({ success: false, error: "Pergunta inválida." }, { status: 400 });
  }

  const pessoa = user.realUserId ?? user.id;
  if (emCurso.has(pessoa)) {
    return NextResponse.json({ success: false, error: "Espere a resposta anterior terminar." }, { status: 429 });
  }
  if (!checkRateLimit(`luna:${pessoa}`, 40, 24 * 60 * 60_000)) {
    return NextResponse.json({ success: false, error: "Você chegou ao limite de perguntas de hoje. As telas continuam funcionando." }, { status: 429 });
  }

  emCurso.add(pessoa);
  try {
    const resposta = await perguntarLuna(
      { internId: user.id, facultyId: user.facultyId, hoje: localDateStr() },
      parsed.data.mensagens,
      (o) => console.log(JSON.stringify({ ...o, user: user.id, at: new Date().toISOString() })),
    );
    return NextResponse.json({ success: true, data: resposta });
  } finally {
    emCurso.delete(pessoa);
  }
}
