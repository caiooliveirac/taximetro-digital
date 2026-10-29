/**
 * Sinais do interno no calendário — outro serviço, Quero e Posso.
 *
 * Outro serviço é um plantão fora do SAMU: entra na regra das 12h como se
 * fosse plantão. Quando cola num plantão do SAMU (mesmo turno ou turno
 * vizinho), é colisão: o interno precisa sair de um dos dois, e o calendário
 * avisa. Quero e Posso só fazem sentido onde o interno pode de fato pegar
 * plantão: turno livre e com 12h de descanso de tudo, inclusive do outro
 * serviço. Fonte única para a API e para a tela.
 */
import { turnosColados, type TurnoDePlantao } from "./rest-policy";

export const SINAIS_DO_DIA = ["OUTRO_SERVICO", "QUERO", "POSSO"] as const;
export type SinalDoDia = (typeof SINAIS_DO_DIA)[number];

export type SinalMarcado = {
  date: string;
  period: "DAY" | "NIGHT";
  signal: SinalDoDia;
  label?: string | null;
};

type PlantaoDoInterno = TurnoDePlantao & { id?: string; baseName?: string };

const chave = (date: string, period: "DAY" | "NIGHT") => `${date.slice(0, 10)}|${period}`;

function nomeDoPlantao(p: PlantaoDoInterno) {
  return (p.baseName ?? p.baseCode).replace(/^Base\s+/i, "");
}

/**
 * Por que o interno não pode marcar este sinal neste turno, ou null se pode.
 * Outro serviço sempre pode: marcar a verdade é o que revela a colisão.
 */
export function motivoParaRecusarSinal(params: {
  signal: SinalDoDia;
  turno: { date: string; period: "DAY" | "NIGHT" };
  plantoes: PlantaoDoInterno[];
  sinais: SinalMarcado[];
}): string | null {
  const { signal, turno, plantoes, sinais } = params;
  if (signal === "OUTRO_SERVICO") return null;

  const k = chave(turno.date, turno.period);
  const colados = new Set(turnosColados(turno));

  const noTurno = plantoes.find((p) => chave(p.date, p.period) === k);
  if (noTurno) {
    return `Você já está de plantão em ${nomeDoPlantao(noTurno)} nesse turno. Para sair dele, oferte para troca.`;
  }
  const outros = sinais.filter((s) => s.signal === "OUTRO_SERVICO");
  if (outros.some((s) => chave(s.date, s.period) === k)) {
    return "Esse turno está marcado como outro serviço.";
  }
  // Meio turno do EBMSP não fecha vizinho (mesma exceção de rest-policy.ts).
  const vizinho = plantoes.find((p) => !p.shift && colados.has(chave(p.date, p.period)));
  if (vizinho) {
    return `Sem 12h de descanso: colado no seu plantão de ${nomeDoPlantao(vizinho)}.`;
  }
  if (outros.some((s) => colados.has(chave(s.date, s.period)))) {
    return "Sem 12h de descanso: colado num outro serviço seu.";
  }
  return null;
}

/**
 * Plantões do SAMU que colidem com um outro serviço marcado: mesmo turno ou
 * turno colado. Devolve, por plantão, o sinal de outro serviço que colide.
 */
export function colisoesComOutroServico<P extends PlantaoDoInterno & { id: string }>(
  plantoes: P[],
  sinais: SinalMarcado[],
): Map<string, SinalMarcado> {
  const outros = new Map<string, SinalMarcado>();
  for (const s of sinais) if (s.signal === "OUTRO_SERVICO") outros.set(chave(s.date, s.period), s);

  const colisoes = new Map<string, SinalMarcado>();
  for (const p of plantoes) {
    const mesmo = outros.get(chave(p.date, p.period));
    if (mesmo) {
      colisoes.set(p.id, mesmo);
      continue;
    }
    if (p.shift) continue;
    for (const vizinho of turnosColados({ date: p.date.slice(0, 10), period: p.period })) {
      const o = outros.get(vizinho);
      if (o) {
        colisoes.set(p.id, o);
        break;
      }
    }
  }
  return colisoes;
}
