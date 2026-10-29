/**
 * Luna do interno: responde sobre plantões possíveis — meta, vagas liberadas,
 * extras, trocas — chamando as ferramentas de luna-ferramentas.ts, que só leem.
 *
 * Mesmo modelo e mesmo formato da Luna do samu-workspace: OpenAI
 * chat/completions com tools, `gpt-6-luna`, reasoning_effort "none" (o modelo
 * só aceita tools assim). Os cartões com ação vêm do resultado das
 * ferramentas, não do texto do modelo.
 */

import { FERRAMENTAS, type LunaCartao, type LunaCtx } from "@/lib/luna-ferramentas";

type ChatMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

export type LunaPergunta = { role: "user" | "assistant"; content: string };
export type LunaResposta = { texto: string; cartoes: LunaCartao[]; erro?: boolean };

const VOLTAS = 4;
const HISTORICO = 8;

const config = () => ({
  key: process.env.OPENAI_API_KEY ?? "",
  model: process.env.LUNA_MODEL || "gpt-6-luna",
  base: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  effort: process.env.LUNA_REASONING_EFFORT ?? "none",
});

export const lunaLigada = () => Boolean(config().key);

const SISTEMA = `Você é a Luna, assistente dos internos de medicina no SAMU Salvador, dentro do app Taxímetro.
Seu trabalho: ajudar o interno a achar plantão possível — fechar a meta, trocar um plantão, pegar vaga liberada ou extra.

Regras de resposta:
- Português do Brasil, curto e direto, tom de colega. No máximo 6 linhas de texto; listas com "- ".
- Sempre consulte as ferramentas antes de afirmar qualquer dado. Nunca invente plantão, vaga, data, nome ou regra.
- Datas como aparecem nas ferramentas ("sex 31/10 noite").
- Você não executa nada: não escala, não troca, não pega vaga. Diga onde o interno faz (os cartões abaixo da sua resposta já trazem os botões).
- Se o pedido não for sobre plantões, trocas, vagas, meta ou bases, diga em uma linha que só ajuda com isso.

Regras do sistema (para explicar quando perguntarem):
- Meta: casinhas por tipo (USA, CRU, CRL) na rotação. Realizados, o plantão de hoje e os agendados ocupam casinha. Extra não conta para a meta.
- Vaga liberada: outra faculdade abriu mão daquela vaga. Por enquanto só serve a quem ainda está abaixo da meta naquele tipo, e quem escala é o líder da faculdade do interno — o interno pede ao líder (o cartão abre a conversa já escrita).
- Troca: mesmo tipo (USA↔USA, CRU↔CRU, CRL↔CRL), 12h de descanso entre plantões, CRU só uma troca por rodízio. USA dá para trocar com interno de qualquer faculdade; CRU e CRL, só com a mesma. Vale quando quem ofereceu confirma. Dá para combinar pelo chat (botão Conversar).
- Extra: primeiro que pegar, na aba Extras.
- Vaga sobrando na grade da própria faculdade: pedido na aba Trocas → Extra, aprovado pelo líder.
- Bases: o mapa na aba Bases abre a rota no Maps, Waze ou Uber a partir de onde o interno está.`;

function dataDeHoje(hoje: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", dateStyle: "full" }).format(new Date(`${hoje}T12:00:00-03:00`));
}

export async function perguntarLuna(ctx: LunaCtx, conversa: LunaPergunta[], log: (o: Record<string, unknown>) => void): Promise<LunaResposta> {
  const { key, model, base, effort } = config();
  const msgs: ChatMsg[] = [
    { role: "system", content: `${SISTEMA}\n\nHoje: ${dataDeHoje(ctx.hoje)} (${ctx.hoje}).` },
    ...conversa.slice(-HISTORICO).map((m) => ({ role: m.role, content: m.content.slice(0, 1500) })),
  ];
  const cartoes = new Map<string, LunaCartao>();
  const uso = { entrada: 0, saida: 0 };
  const t0 = Date.now();
  const chamadas: string[] = [];

  for (let volta = 0; volta < VOLTAS; volta++) {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        ...(effort ? { reasoning_effort: effort } : {}),
        messages: msgs,
        tools: FERRAMENTAS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
        parallel_tool_calls: true,
        max_completion_tokens: 700,
      }),
      signal: AbortSignal.timeout(40_000),
    }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ error: { code: e.name } }) }) as unknown as Response);

    const j = (await r.json().catch(() => null)) as {
      choices?: { message: ChatMsg }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { code?: string; message?: string };
    } | null;
    uso.entrada += j?.usage?.prompt_tokens ?? 0;
    uso.saida += j?.usage?.completion_tokens ?? 0;

    if (!r.ok || !j?.choices?.[0]) {
      log({ ev: "luna_interno_erro", status: r.status, code: j?.error?.code ?? null, msg: j?.error?.message?.slice(0, 200) ?? null });
      return { texto: "A Luna não conseguiu responder agora. As telas de Trocas, Extras e Bases seguem funcionando.", cartoes: [...cartoes.values()], erro: true };
    }

    const m = j.choices[0].message;
    if (!m.tool_calls?.length) {
      log({ ev: "luna_interno", ms: Date.now() - t0, voltas: volta + 1, ferramentas: chamadas, ...uso });
      return { texto: m.content ?? "", cartoes: [...cartoes.values()] };
    }

    msgs.push({ role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls });
    const feitas = await Promise.all(
      m.tool_calls.slice(0, 5).map(async (call) => {
        const ferramenta = FERRAMENTAS.find((f) => f.name === call.function.name);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {}
        chamadas.push(call.function.name);
        const res = ferramenta
          ? await ferramenta.run(ctx, args).catch((e: Error) => {
              log({ ev: "luna_interno_ferramenta_erro", ferramenta: call.function.name, msg: e.message.slice(0, 200) });
              return { dados: { erro: "consulta falhou" } };
            })
          : { dados: { erro: "ferramenta desconhecida" } };
        return { call, res };
      }),
    );
    for (const { call, res } of feitas) {
      if ("cartao" in res && res.cartao) cartoes.set(res.cartao.tipo, res.cartao);
      msgs.push({ role: "tool", tool_call_id: call.id, content: `<dados>${JSON.stringify(res.dados).slice(0, 10_000)}</dados>` });
    }
    for (const call of m.tool_calls.slice(5)) {
      msgs.push({ role: "tool", tool_call_id: call.id, content: `<dados>{"erro":"limite de consultas"}</dados>` });
    }
  }

  log({ ev: "luna_interno", ms: Date.now() - t0, voltas: VOLTAS, ferramentas: chamadas, ...uso, parou: true });
  return { texto: "Parei: muitas consultas seguidas. Refaça a pergunta mais direta.", cartoes: [...cartoes.values()] };
}
