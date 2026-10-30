/**
 * Caminho rápido da Luna: pergunta curta e inequívoca ("quanto falta pra
 * minha meta?", "tenho plantão amanhã?", "checkout pendente?") é respondida
 * direto do banco, sem chamar o modelo. Qualquer sinal de restrição,
 * referência ou nuance ("não posso", "sábado", "essa", "por que") manda para
 * o modelo — errar para o lado do modelo custa centavos; errar para cá dá
 * resposta torta.
 */

import type { ArgsBusca } from "@/lib/luna-ferramentas";
import { diaDaSemana } from "@/lib/luna-inteligencia";
import { addDaysToDateStr, localDateStr } from "@/lib/utils";

export type Intencao =
  | { tipo: "META" }
  | { tipo: "AGENDA"; de: number; ate: number | null; janela?: string }
  | { tipo: "PRESENCA" }
  /** "Estou na base tal, vai ativar?": a base é resolvida pelo nome/código no texto ou pelo plantão dele. */
  | { tipo: "BASE_AGORA" }
  /** "Tenho solicitação pendente?": lista as dele e avisa o líder (route.ts manda a mensagem). */
  | { tipo: "SOLICITACOES" }
  | { tipo: "BUSCA"; args: ArgsBusca };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Restrição, referência a algo anterior, explicação ou condição: precisa interpretar. */
const NUANCE = /\b(significa\w*|quer dizer|o que (e|eh)|como funciona|o que acontece|nao (posso|da|consigo|quero)|prova|aula|prefir\w*|prefer\w*|exceto|menos|evit\w*|segunda|terca|quarta|quinta|sexta|sabado|domingo|seg|ter|qua|qui|sex|sab|dom|fim de semana|\d{1,2}\/\d{1,2}|ess[ae]s?|dess[ae]s?|opc(ao|oes)|e se|melhor|mas|mesmo|por ?que|pq|explica\w*|nao cont\w*|noite|notur\w*|diurn\w*|manha|tarde|perto|longe|com o|com a|colega)\b/;
const TIPO = /\b(usa|cru|crl)\b/;
const SOLICITACOES = /\bsolicita(cao|coes|ei|do|da|dos|das)\b|\bmeus? pedidos?\b|\bpedido pendente|nao (analisaram|aprovaram|responderam|avaliaram|viram)|(ninguem|lider|coordenacao) (ainda )?(nao )?(aprovou|analisou|respondeu|viu)/;

// Pergunta por dia ("dia 09/11 tem?", "preciso pegar dia 29, 30 e 01",
// "tem vaga sábado?"): vai direto, só naqueles dias. Formas reais no audit_log
// (DAI_PERGUNTA); a que ainda for ao modelo com `datas` nos args é a próxima a
// entrar aqui — ver docs/luna-catalogo.md, "Ensinar o roteador".
// "Tem" sozinho não basta ("tem enfermeiro na 30 hoje?"): precisa falar de
// vaga/plantão, ou ser só o dia + "tem?".
const DISPONIVEL = /\b(vagas?|plantao|plantoes|turnos?|pegar|pego|disponive(l|is)|livres?|extras?|sobr\w*|abert[oa]s?)\b|^(e )?(no |na |pro |pra )?dias? [\d/ ,e]+ tem( algo| alguma coisa)?\W*$|^tem (algo|alguma coisa) (no |na |pro |pra )?dias? [\d/ ,e]+\W*$/;
const SO_COM_MODELO = /\b(nao|prova|aula|compromisso|exceto|menos|evit\w*|ess[ae]s?|dess[ae]s?|opc(ao|oes)|e se|por ?que|pq|explica\w*|troca\w*|colega|perto|longe|prefir\w*|prefer\w*|melhor|significa\w*|mesmo|mas)\b/;
const SEMANA: Record<string, number> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };

function dataValida(ano: number, mes: number, dia: number): string | null {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? d.toISOString().slice(0, 10) : null;
}

/** "29" → o próximo dia 29; "09/11" → 09/11 deste ano (ou do próximo, se já passou há meses). */
function proximaData(hoje: string, dia: number, mes?: number): string | null {
  const [a, m] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
  if (mes) {
    const d = dataValida(a, mes, dia);
    return d && d < addDaysToDateStr(hoje, -60) ? dataValida(a + 1, mes, dia) : d;
  }
  for (let i = 0; i < 3; i++) {
    const d = dataValida(a + Math.floor((m - 1 + i) / 12), ((m - 1 + i) % 12) + 1, dia);
    if (d && d >= hoje) return d;
  }
  return null;
}

/** Datas citadas, de hoje em diante, sem repetir. Vazio = nenhuma data reconhecível. */
export function datasDaPergunta(q: string, hoje: string): string[] {
  const datas: string[] = [];
  for (const m of q.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g)) datas.push(proximaData(hoje, Number(m[1]), Number(m[2])) ?? "");
  // "dia 29", "dias 29, 30 e 01", "dia 5 e 6"
  for (const m of q.matchAll(/\bdias? ((?:\d{1,2}(?![\d/]))(?:\s*(?:,|e)\s*\d{1,2}(?![\d/]))*)/g)) {
    for (const n of m[1].split(/\s*(?:,|\be\b)\s*/)) if (n) datas.push(proximaData(hoje, Number(n)) ?? "");
  }
  if (/\bdepois de amanha\b/.test(q)) datas.push(addDaysToDateStr(hoje, 2));
  else if (/\bamanha\b/.test(q)) datas.push(addDaysToDateStr(hoje, 1));
  if (/\bhoje\b/.test(q)) datas.push(hoje);
  // "segunda" sozinha pode ser "a segunda opção": só com -feira ou "na/no/próxima".
  for (const m of q.matchAll(/\b(?:(?:na|no|nesta|neste|nessa|nesse|esta|este|essa|esse|proxima|proximo) )?(domingo|sabado)\b|\b(segunda|terca|quarta|quinta|sexta)[ -]feira\b|\b(?:na|nesta|nessa|esta|essa|proxima) (terca|quarta|quinta|sexta)\b/g)) {
    const alvo = SEMANA[m[1] ?? m[2] ?? m[3]];
    const d = Array.from({ length: 7 }, (_, i) => addDaysToDateStr(hoje, i)).find((x) => diaDaSemana(x) === alvo)!;
    datas.push(d);
  }
  return [...new Set(datas.filter((d) => d && d >= hoje))].sort();
}

function porDia(q: string, hoje: string): Intencao | null {
  if (q.length > 120 || !DISPONIVEL.test(q) || SO_COM_MODELO.test(q)) return null;
  const datas = datasDaPergunta(q, hoje);
  if (!datas.length) return null;
  const periodo = /\b(noite|notur\w*)\b/.test(q) ? "noite" : /\b(diurn\w*|de dia|manha)\b/.test(q) ? "dia" : undefined;
  // "Tenho plantão dia 09?" é a agenda dele, não vaga.
  if (/\btenho (algum )?plantao\b|\bmeus? plantao\b|\bestou escalad/.test(q)) {
    const de = Math.round((Date.parse(datas[0]) - Date.parse(hoje)) / 86_400_000);
    const ate = Math.round((Date.parse(datas.at(-1)!) - Date.parse(hoje)) / 86_400_000);
    const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
    const janela = datas.length > 1 ? `entre ${dm(datas[0])} e ${dm(datas.at(-1)!)}` : de === 0 ? "hoje" : de === 1 ? "amanhã" : `em ${dm(datas[0])}`;
    return { tipo: "AGENDA", de, ate, janela };
  }
  const tipos = (["usa", "cru", "crl"] as const).filter((t) => new RegExp(`\\b${t}\\b`).test(q)).map((t) => t.toUpperCase() as "USA" | "CRU" | "CRL");
  const fontes: ArgsBusca["fontes"] = /vagas? liberad/.test(q) ? ["LIBERADA"] : /\bextras?\b/.test(q) ? ["EXTRA"] : /\bgrade\b|sobr\w* vaga|vaga sobr/.test(q) ? ["GRADE"] : undefined;
  return {
    tipo: "BUSCA",
    args: {
      objetivo: "plantao",
      ...(tipos.length ? { tipos } : {}),
      ...(fontes ? { fontes } : {}),
      datas: datas.map((data) => ({ data, ...(periodo ? { periodo } : {}) })),
    },
  };
}
const BASE_AGORA = /vai (ativar|abrir|funcionar|rodar)|(base|viatura|ela) (esta |ta |vai )?(ativa|ativada|desativada|parada|aberta|fechada)|ativ(ou|ada|a) (a |hoje)|(tem|chegou|ja chegou|cade|cade o|quem e o|qual) (o |algum |um )?medico|medico (chegou|ja chegou|de plantao|na base|ta ai|esta ai)|sem medico|(estou|to|tou|cheguei) na base/;

export function rotear(pergunta: string, hoje: string = localDateStr()): Intencao | null {
  const q = norm(pergunta);
  // Antes da peneira de nuance: "vai ativar hoje à noite?" é a mesma pergunta.
  if (q.length <= 120 && BASE_AGORA.test(q)) return { tipo: "BASE_AGORA" };
  if (q.length <= 160 && SOLICITACOES.test(q) && !/\b(como|onde) (eu )?(faco|faz|peco|pede)\b/.test(q)) return { tipo: "SOLICITACOES" };
  const dia = porDia(q, hoje);
  if (dia) return dia;
  if (q.length > 90 || NUANCE.test(q)) return null;

  if (/check ?-?(in|out)|presenca|frequencia|pendencia/.test(q)) return { tipo: "PRESENCA" };

  if (/(consigo|da pra|da para|como|ajuda|quero|vou) .*(fechar|completar|terminar|bater|cumprir)|vagas? .*(meta)|(fechar|completar) (a |minha )?meta/.test(q) && !/quanto/.test(q)) {
    return TIPO.test(q) ? null : { tipo: "BUSCA", args: { objetivo: "meta" } };
  }
  if (/(quanto|quantos|quantas|o que) (me |ainda )?falta|minha meta|da meta|pra terminar|para terminar|casinha/.test(q)) return { tipo: "META" };

  if (/plantao (hoje|amanha)|plantoes? (de )?(hoje|amanha)|(hoje|amanha) (eu )?tenho plantao/.test(q) || /tenho (algum )?plantao/.test(q)) {
    if (/amanha/.test(q)) return { tipo: "AGENDA", de: 1, ate: 1, janela: "amanhã" };
    if (/hoje/.test(q)) return { tipo: "AGENDA", de: 0, ate: 0, janela: "hoje" };
  }
  if (/proxim\w* plant|meus plant|minha (agenda|escala)|quando (e|eh) (o )?meu/.test(q)) return { tipo: "AGENDA", de: 0, ate: null };

  if (TIPO.test(q)) return null;
  if (/vagas? liberad/.test(q)) return { tipo: "BUSCA", args: { objetivo: "plantao", fontes: ["LIBERADA"] } };
  if (/\bextras?\b/.test(q)) return { tipo: "BUSCA", args: { objetivo: "plantao", fontes: ["EXTRA"] } };
  if (/\bgrade\b|sobr\w* vaga|vaga sobr/.test(q)) return { tipo: "BUSCA", args: { objetivo: "plantao", fontes: ["GRADE"] } };
  if (/\btroca(s|r)?\b/.test(q)) return { tipo: "BUSCA", args: { objetivo: "troca" } };
  if (/(tem|ha|quais|alguma|que) vagas?|vagas? (pra|para) mim|posso pegar|plantao a mais/.test(q)) return { tipo: "BUSCA", args: { objetivo: "plantao" } };
  return null;
}
