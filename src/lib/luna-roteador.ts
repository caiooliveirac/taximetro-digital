/**
 * Caminho rápido da Luna: pergunta curta e inequívoca ("quanto falta pra
 * minha meta?", "tenho plantão amanhã?", "checkout pendente?") é respondida
 * direto do banco, sem chamar o modelo. Qualquer sinal de restrição,
 * referência ou nuance ("não posso", "sábado", "essa", "por que") manda para
 * o modelo — errar para o lado do modelo custa centavos; errar para cá dá
 * resposta torta.
 */

import type { ArgsBusca } from "@/lib/luna-ferramentas";

export type Intencao =
  | { tipo: "META" }
  | { tipo: "AGENDA"; de: number; ate: number | null; janela?: string }
  | { tipo: "PRESENCA" }
  /** "Estou na base tal, vai ativar?": a base é resolvida pelo nome/código no texto ou pelo plantão dele. */
  | { tipo: "BASE_AGORA" }
  | { tipo: "BUSCA"; args: ArgsBusca };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Restrição, referência a algo anterior, explicação ou condição: precisa interpretar. */
const NUANCE = /\b(nao (posso|da|consigo|quero)|prova|aula|prefir\w*|prefer\w*|exceto|menos|evit\w*|segunda|terca|quarta|quinta|sexta|sabado|domingo|seg|ter|qua|qui|sex|sab|dom|fim de semana|\d{1,2}\/\d{1,2}|ess[ae]s?|dess[ae]s?|opc(ao|oes)|e se|melhor|mas|mesmo|por ?que|pq|explica\w*|nao cont\w*|noite|notur\w*|diurn\w*|manha|tarde|perto|longe|com o|com a|colega)\b/;
const TIPO = /\b(usa|cru|crl)\b/;
const BASE_AGORA = /vai (ativar|abrir|funcionar|rodar)|(base|viatura|ela) (esta |ta |vai )?(ativa|ativada|desativada|parada|aberta|fechada)|ativ(ou|ada|a) (a |hoje)|(tem|chegou|ja chegou|cade|cade o|quem e o|qual) (o |algum |um )?medico|medico (chegou|ja chegou|de plantao|na base|ta ai|esta ai)|sem medico|(estou|to|tou|cheguei) na base/;

export function rotear(pergunta: string): Intencao | null {
  const q = norm(pergunta);
  // Antes da peneira de nuance: "vai ativar hoje à noite?" é a mesma pergunta.
  if (q.length <= 120 && BASE_AGORA.test(q)) return { tipo: "BASE_AGORA" };
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
