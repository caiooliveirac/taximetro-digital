/**
 * Dai (nome visível; o código segue `luna-*`) — assistente do interno: responde sobre plantões possíveis — meta, vagas liberadas,
 * extras, trocas, presença.
 *
 * Três caminhos, do mais barato ao mais caro:
 *  1. direto — pergunta inequívoca (luna-roteador): consulta e responde, sem modelo;
 *  2. uma chamada — o resumo do interno já vai no prompt; o modelo responde
 *     direto ou escolhe UMA ferramenta e traduz o pedido em parâmetros;
 *  3. a ferramenta devolve a resposta pronta (luna-ferramentas), que vai ao
 *     interno sem segunda volta ao modelo.
 *
 * Modelo: OpenAI chat/completions com tools, `gpt-6-luna`, reasoning_effort
 * "none" (o modelo só aceita tools assim). Os cartões com ação vêm das
 * ferramentas, não do texto do modelo.
 */

import { criarFontes, type Fontes, type LunaCtx, type RegistroFonte } from "@/lib/luna-dados";
import { FERRAMENTAS, buscar, situacaoDaBase, type LunaCartao, type LunaMemoria, type Resultado } from "@/lib/luna-ferramentas";
import { quando, resumoParaModelo, textoDaAgenda, textoDaPresenca, ativos } from "@/lib/luna-inteligencia";
import { rotear, type Intencao } from "@/lib/luna-roteador";
import { addDaysToDateStr } from "@/lib/utils";

type ChatMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

export type LunaPergunta = { role: "user" | "assistant"; content: string; memoria?: LunaMemoria };
export type LunaResposta = { texto: string; cartoes: LunaCartao[]; erro?: boolean; memoria?: LunaMemoria };
export type LunaDeps = { fontes?: Fontes; fetch?: typeof fetch };

const HISTORICO = 6;
const MAX_FERRAMENTAS = 3;

const config = () => ({
  key: process.env.OPENAI_API_KEY ?? "",
  model: process.env.LUNA_MODEL || "gpt-6-luna",
  base: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  effort: process.env.LUNA_REASONING_EFFORT ?? "none",
});

export const lunaLigada = () => Boolean(config().key);

const META_NA_TELA = "Sua meta, tipo por tipo, está na tela **Início**. Aqui eu procuro o que fecha ela: pergunte \"que vagas fecham minha meta?\".";

const FALHOU = "Não consegui consultar seus dados agora — não vou chutar. As telas de Início, Trocas e Extras seguem funcionando.";

const SISTEMA = `Você é o Dai, assistente dos internos de medicina no SAMU Salvador, no app Taxímetro. Ajuda a achar plantão possível: fechar a meta, trocar, pegar vaga liberada, extra ou sobra da grade.

Como agir:
- RESUMO abaixo é o estado real do interno agora (rodízio, próximos plantões). Pergunta só sobre isso: responda direto, sem ferramenta.
- Meta e casinhas ele já vê na tela Início: não repita números de meta; se perguntar, aponte a tela Início.
- Vaga, extra, troca, opção, "consigo fechar a meta", "melhor solução": chame buscar_opcoes com as restrições que ele disse (nao_posso, prefere_*, tipos). Não filtre nem conte nada você: a ferramenta cruza meta, descanso e agenda.
- "Vai ativar?", "tem médico?", "o médico chegou?": situacao_da_base.
- Trocar um plantão dele por uma oferta específica: avaliar_troca. "Por que não contou", "fiz checkout e aparece pendente": explicar_plantao.
- "A segunda", "essa", "dessas" = números da ÚLTIMA LISTA: passe em opcoes/opcao. Sem ÚLTIMA LISTA, não invente número. Para refinar a última busca, repita os parâmetros dela e mude só o pedido.
- Datas: use o CALENDÁRIO; dia da semana vai como dia_semana. "Fim de semana" = prefere_dias_semana sex, sab, dom.
- nao_posso é só o que ele disse que não pode (prova, compromisso). Plantão que ele já tem NÃO entra: a ferramenta já respeita a agenda e o descanso.
- Pergunta de regra ("e se eu faltar?", "fecha com uma falta?", "posso pegar com a meta completa?"): responda pelas Regras, sem ferramenta.
- Sem ferramenta: português, até 5 linhas, tom de colega. Nunca invente plantão, vaga, data, nome ou regra. Você não executa nada. Fora de plantões/trocas/vagas/meta/bases: diga em uma linha que só ajuda com isso.

Regras (para explicar):
- Meta: casinhas por tipo (USA, CRU, CRL) no rodízio. Realizados, o de hoje e os agendados ocupam casinha. Extra não conta. Falta não ocupa casinha: ela volta a ficar vazia e precisa de reposição (vaga liberada pelo líder ou sobra da grade). Falta abonada conta.
- Vaga liberada (outra faculdade abriu mão): só para quem ainda tem casinha vazia no tipo; quem escala é o líder da faculdade dele.
- Troca: mesmo tipo, 12h de descanso, CRU uma por rodízio; USA e CRU com qualquer faculdade, CRL só com a mesma; vale quando quem ofereceu confirma.
- Extra: primeiro que pegar, aba Extras. Sobra da grade: pede em Trocas → Extra, o líder aprova.`;

function calendario(hoje: string) {
  return Array.from({ length: 15 }, (_, i) => {
    const d = addDaysToDateStr(hoje, i);
    return `${quando(d, "DAY").slice(0, -4)}=${d}`;
  }).join(", ");
}

function memoriaAtual(conversa: LunaPergunta[]): LunaMemoria | undefined {
  for (let i = conversa.length - 1; i >= 0; i--) if (conversa[i].role === "assistant" && conversa[i].memoria) return conversa[i].memoria;
  return undefined;
}

async function direto(intencao: Intencao, f: Fontes, ctx: LunaCtx, memoria: LunaMemoria | undefined, pergunta: string): Promise<Resultado> {
  if (intencao.tipo === "BUSCA") return buscar(f, ctx, intencao.args as Record<string, unknown>, memoria);
  // A meta está na tela Início: aqui não se gasta consulta nem token com ela.
  if (intencao.tipo === "META") return { status: "OK", registros: 0, texto: META_NA_TELA };
  if (intencao.tipo === "BASE_AGORA") return situacaoDaBase(f, ctx, pergunta);
  const [meta, meus] = await Promise.all([f.meta(), f.meusPlantoes()]);
  if (intencao.tipo === "PRESENCA") return { status: "OK", registros: meus.length, texto: textoDaPresenca(meus, ctx.hoje, meta?.inicio ?? null) };
  const de = addDaysToDateStr(ctx.hoje, intencao.de);
  const ate = intencao.ate === null ? null : addDaysToDateStr(ctx.hoje, intencao.ate);
  const lista = ativos(meus).filter((m) => m.date >= de && (!ate || m.date <= ate)).slice(0, 6);
  return {
    status: lista.length ? "OK" : "NO_OPTIONS",
    registros: meus.length,
    texto: textoDaAgenda(meus, de, ate, intencao.janela),
    cartao: lista.length
      ? {
          tipo: "plantoes",
          titulo: "Seus plantões",
          itens: lista.map((m) => ({ titulo: `${m.baseCode} · ${quando(m.date, m.period, m.shift)}`, detalhe: `${m.tipo ?? "?"}${m.isExtraShift ? " · extra" : ""}`, mapa: m.baseCode })),
          verTudo: { href: "/intern/calendario", rotulo: "Abrir calendário" },
        }
      : undefined,
  };
}

export async function perguntarLuna(
  ctx: LunaCtx,
  conversa: LunaPergunta[],
  log: (o: Record<string, unknown>) => void,
  deps: LunaDeps = {},
): Promise<LunaResposta> {
  const t0 = Date.now();
  const fontes: RegistroFonte[] = [];
  const f = deps.fontes ?? criarFontes(ctx, (r) => fontes.push(r));
  const memoria = memoriaAtual(conversa);
  const pergunta = conversa.at(-1)?.content ?? "";
  const ferramentas: { nome: string; ms: number; status: string; registros: number }[] = [];
  const registro = (extra: Record<string, unknown>) => log({ ev: "luna_interno", ms: Date.now() - t0, ferramentas, fontes, ...extra });

  // 1. Direto.
  const intencao = rotear(pergunta);
  if (intencao) {
    const t1 = Date.now();
    try {
      const r = await direto(intencao, f, ctx, memoria, pergunta);
      ferramentas.push({ nome: intencao.tipo.toLowerCase(), ms: Date.now() - t1, status: r.status, registros: r.registros });
      registro({ rota: "direta", intencao: intencao.tipo, chamadas_modelo: 0, entrada: 0, saida: 0 });
      return { texto: r.texto, cartoes: r.cartao ? [r.cartao] : [], memoria: r.memoria ?? memoria };
    } catch (e) {
      registro({ rota: "direta", intencao: intencao.tipo, chamadas_modelo: 0, erro: (e as Error).message.slice(0, 200) });
      return { texto: FALHOU, cartoes: [], erro: true, memoria };
    }
  }

  // 2. Uma chamada, com o resumo já no prompt.
  let resumo: string;
  try {
    const [meta, meus] = await Promise.all([f.meta(), f.meusPlantoes()]);
    resumo = resumoParaModelo(meta, meus, ctx.hoje);
  } catch (e) {
    registro({ rota: "modelo", chamadas_modelo: 0, erro: (e as Error).message.slice(0, 200) });
    return { texto: FALHOU, cartoes: [], erro: true, memoria };
  }
  const contexto = [
    `RESUMO: ${resumo}`,
    `CALENDÁRIO: ${calendario(ctx.hoje)}`,
    memoria?.busca ? `ÚLTIMA BUSCA: ${JSON.stringify(memoria.busca)}` : "",
    memoria?.opcoes?.length ? `ÚLTIMA LISTA: ${memoria.opcoes.map((o) => `${o.n}=${o.fonte.toLowerCase()}`).join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const { key, model, base, effort } = config();
  const msgs: ChatMsg[] = [
    { role: "system", content: `${SISTEMA}\n\n${contexto}` },
    ...conversa.slice(-HISTORICO).map((m) => ({ role: m.role, content: m.content.slice(0, 1200) })),
  ];
  const r = await (deps.fetch ?? fetch)(`${base}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      ...(effort ? { reasoning_effort: effort } : {}),
      messages: msgs,
      tools: FERRAMENTAS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
      parallel_tool_calls: true,
      max_completion_tokens: 400,
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ error: { code: e.name } }) }) as unknown as Response);

  const j = (await r.json().catch(() => null)) as {
    choices?: { message: ChatMsg }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { code?: string; message?: string };
  } | null;
  const uso = { entrada: j?.usage?.prompt_tokens ?? 0, saida: j?.usage?.completion_tokens ?? 0 };

  if (!r.ok || !j?.choices?.[0]) {
    registro({ rota: "modelo", chamadas_modelo: 1, ...uso, erro: j?.error?.code ?? `http_${r.status}`, msg: j?.error?.message?.slice(0, 200) ?? null });
    return { texto: "O Dai não conseguiu responder agora. As telas de Trocas, Extras e Bases seguem funcionando.", cartoes: [], erro: true, memoria };
  }

  const m = j.choices[0].message;
  if (!m.tool_calls?.length) {
    registro({ rota: "modelo", chamadas_modelo: 1, ...uso });
    return { texto: m.content ?? "", cartoes: [], memoria };
  }

  // 3. Ferramentas: a resposta delas é a resposta final.
  const feitas = await Promise.all(
    m.tool_calls.slice(0, MAX_FERRAMENTAS).map(async (call) => {
      const t1 = Date.now();
      const ferramenta = FERRAMENTAS.find((x) => x.name === call.function.name);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {}
      if (!ferramenta) return null;
      const res = await ferramenta.run(f, ctx, args, memoria).catch((e: Error): Resultado => {
        log({ ev: "luna_interno_ferramenta_erro", ferramenta: call.function.name, msg: e.message.slice(0, 200) });
        return { status: "FAILED", registros: 0, texto: "Essa consulta falhou agora — não tenho como afirmar nada sobre isso. Tente de novo em instantes." };
      });
      ferramentas.push({ nome: call.function.name, ms: Date.now() - t1, status: res.status, registros: res.registros });
      return res;
    }),
  );
  const ok = feitas.filter((x): x is Resultado => Boolean(x));
  const nova = [...ok].reverse().find((x) => x.memoria)?.memoria;
  registro({ rota: "modelo+ferramenta", chamadas_modelo: 1, ...uso, args: m.tool_calls.slice(0, MAX_FERRAMENTAS).map((c) => `${c.function.name}:${c.function.arguments.slice(0, 300)}`) });
  if (!ok.length) return { texto: m.content || "Não entendi o pedido. Pode dizer de outro jeito?", cartoes: [], memoria };
  return {
    texto: ok.map((x) => x.texto).join("\n\n"),
    cartoes: ok.flatMap((x) => (x.cartao ? [x.cartao] : [])),
    erro: ok.every((x) => x.status === "FAILED") || undefined,
    memoria: nova ?? memoria,
  };
}
