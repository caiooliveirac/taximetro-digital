/**
 * /api/intern/luna — pergunta ao Dai (ver src/lib/luna-interno.ts).
 *
 * GET  → { ligada } (sem OPENAI_API_KEY a tela mostra só os atalhos)
 * POST → { mensagens: [{ role, content, memoria? }] } → { texto, cartoes, memoria }
 *
 * Teto por pessoa: 10 perguntas por dia que chamam o modelo (contadas no
 * audit_log, sobrevivem ao deploy); as que saem direto do banco seguem
 * respondendo. Uma de cada vez, pergunta de até 300 caracteres.
 * Cada pergunta do interno (não personificado) vira DAI_PERGUNTA no audit_log, 90 dias.
 * "Tenho solicitação pendente?" manda a lista ao líder por mensagem da Dai —
 * a escrita é aqui, não nos arquivos luna-* (só leitura).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEffectiveUser } from "@/lib/impersonate";
import { gravarPergunta, perguntasComModeloHoje } from "@/lib/dai-perguntas";
import { avisarLiderDasSolicitacoes } from "@/features/dai-avisos/avisos";
import { lunaLigada, perguntarLuna } from "@/lib/luna-interno";
import { checkRateLimit } from "@/shared/infra/rate-limit";
import { localDateStr } from "@/lib/utils";

// Memória da conversa: só referências (número → fonte + id) e os parâmetros da
// última busca. As ferramentas revalidam cada id contra a lista atual do
// próprio interno, então um id forjado aqui não mostra nada alheio.
const memoria = z
  .object({
    // Vai inteira para o prompt: sem teto, um JSON gigante vira conta gigante.
    busca: z.record(z.string(), z.unknown()).refine((b) => JSON.stringify(b).length <= 800).optional(),
    opcoes: z
      .array(z.object({ n: z.number().int().min(1).max(20), fonte: z.enum(["LIBERADA", "EXTRA", "GRADE", "TROCA"]), id: z.string().max(120) }))
      .max(12)
      .optional(),
  })
  .optional();

const PERGUNTA_MAX = 300;
const TETO_MODELO_DIA = 10;
// Caminho direto não gasta token; este teto só segura abuso.
const TETO_DIA = 80;
const SEM_TOKENS = "Seus tokens de IA com a Dai acabaram por hoje — amanhã eles voltam. Os atalhos acima seguem respondendo, e as telas continuam funcionando.";

const pedido = z.object({
  mensagens: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000), memoria }))
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
  if (!lunaLigada()) return NextResponse.json({ success: false, error: "O Dai está desligado no momento." }, { status: 503 });

  const parsed = pedido.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.mensagens.at(-1)?.role !== "user") {
    return NextResponse.json({ success: false, error: "Pergunta inválida." }, { status: 400 });
  }
  if (parsed.data.mensagens.at(-1)!.content.length > PERGUNTA_MAX) {
    return NextResponse.json({ success: false, error: `Pergunta longa demais: até ${PERGUNTA_MAX} caracteres.` }, { status: 400 });
  }

  const pessoa = user.realUserId ?? user.id;
  if (emCurso.has(pessoa)) {
    return NextResponse.json({ success: false, error: "Espere a resposta anterior terminar." }, { status: 429 });
  }
  if (!checkRateLimit(`luna:${pessoa}`, TETO_DIA, 24 * 60 * 60_000)) {
    return NextResponse.json({ success: false, error: "Você chegou ao limite de perguntas de hoje. As telas continuam funcionando." }, { status: 429 });
  }
  // Personificando não grava no audit_log: aí o modelo não tem teto (só o coordenador personifica).
  const hoje = localDateStr();
  const comModelo = user.realUserId ? 0 : await perguntasComModeloHoje(user.id, hoje);

  emCurso.add(pessoa);
  try {
    let meta: Record<string, unknown> = {};
    const { aviso, ...resposta } = await perguntarLuna(
      { internId: user.id, facultyId: user.facultyId, hoje, voz: crypto.randomUUID() },
      parsed.data.mensagens,
      (o) => {
        meta = o;
        console.log(JSON.stringify({ ...o, user: user.id, at: new Date().toISOString() }));
      },
      { semModelo: comModelo >= TETO_MODELO_DIA ? SEM_TOKENS : undefined },
    );
    if (aviso) {
      if (user.realUserId) resposta.texto += "\n(Personificando: o aviso ao líder não foi enviado.)";
      else resposta.texto += `\n${await avisarLiderDasSolicitacoes(user.id, aviso).then(() => aviso.feito, () => aviso.falhou)}`;
    }
    // Personificando, só olha: não entra no estudo do uso real.
    if (!user.realUserId) await gravarPergunta(user.id, parsed.data.mensagens, resposta, meta).catch(() => {});
    return NextResponse.json({ success: true, data: resposta });
  } finally {
    emCurso.delete(pessoa);
  }
}
