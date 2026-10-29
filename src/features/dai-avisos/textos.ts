/**
 * O que a Dai escreve sozinha no chat. Texto montado aqui, sem modelo: é
 * sempre a mesma estrutura, só mudam os dados. Puro, para teste.
 */

import type { GoalKind } from "@/lib/goal-slots";
import { TEMAS, rotuloDoTema, type Tema } from "@/lib/dai-temas";

/**
 * Temas que valem para cada tipo de plantão, na ordem em que a Dai sugere.
 * USA é rua: trauma e parada primeiro. Regulação (CRU) decide prioridade e
 * destino: o que tem janela de tempo primeiro. CRL segue a ordem geral.
 */
const ORDEM_POR_TIPO: Record<GoalKind, Tema[]> = {
  USA: ["TRAUMA", "PCR", "AVC", "IAM", "CONVULSAO", "PSIQ", "CHOQUE", "SEPSE", "ANAFILAXIA", "ASMA", "HDA", "DPOC", "TEP"],
  CRU: ["IAM", "AVC", "TRAUMA", "PCR", "SEPSE", "CHOQUE", "TEP", "HDA", "CONVULSAO", "PSIQ", "ANAFILAXIA", "ASMA", "DPOC"],
  CRL: TEMAS.map((t) => t.tema),
};

/**
 * Primeiro tema da ordem do tipo que o interno ainda não abriu na Dai. Viu
 * todos: gira pelo dia, para não repetir o mesmo sempre.
 */
export function temaParaPlantao(tipo: GoalKind | null, vistos: Iterable<string>, data: string): Tema {
  const ordem = ORDEM_POR_TIPO[tipo ?? "CRL"];
  const jaVistos = new Set(vistos);
  const novo = ordem.find((t) => !jaVistos.has(t));
  if (novo) return novo;
  const dia = Number(data.replaceAll("-", "")) || 0;
  return ordem[dia % ordem.length];
}

const NOME_DO_TIPO: Record<GoalKind, string> = { USA: "USA", CRU: "Central de Regulação", CRL: "CRL" };

export function textoProximoPlantao(p: { quando: string; baseCode: string; tipo: GoalKind | null; tema: Tema }) {
  const tipo = p.tipo ? ` (${NOME_DO_TIPO[p.tipo]})` : "";
  return [
    `Amanhã você está na ${p.baseCode}${tipo}, ${p.quando}.`,
    `Veja onde fica a base e a rota a partir de onde você está na aba Bases.`,
    `Para chegar afiado: revise ${rotuloDoTema(p.tema)}. Na Dai, toque em "Discutir um caso" e escolha esse tema.`,
  ].join("\n");
}

export type VagaAvisada = { baseCode: string; quando: string; tipo: GoalKind; liberadaPor: string | null };

export function textoVagasAbertas(vagas: VagaAvisada[]) {
  const tipos = [...new Set(vagas.map((v) => v.tipo))].join(" e ");
  return [
    `Abriu vaga livre que cabe na sua agenda, e ainda falta ${tipos} na sua meta:`,
    ...vagas.map((v) => `- ${v.baseCode} ${v.quando} (${v.tipo}${v.liberadaPor ? `, liberada pela ${v.liberadaPor}` : ", sem dono"})`),
    `Quem escala é o líder da sua faculdade. Na Dai, toque em "Tem vaga liberada pra mim?" para pedir com um toque — vai rápido, outros colegas também precisam.`,
  ].join("\n");
}

/** Vaga livre a menos de 8h do turno: virou extra, o interno pega direto (repescagem.ts). */
export function textoRepescagem(vagas: VagaAvisada[]) {
  return [
    `Vaga de última hora, ainda sem ninguém, que cabe na sua agenda:`,
    ...vagas.map((v) => `- ${v.baseCode} ${v.quando} (${v.tipo}${v.liberadaPor ? `, liberada pela ${v.liberadaPor}` : ", sem dono"})`),
    `Falta pouco para o turno, então virou extra: você pega direto na aba Extras, sem passar pelo líder. Quem pegar primeiro leva.`,
    `Se ainda falta esse tipo na sua meta, conta na meta; se já fechou, entra como extra — um por interno: quem já teve extra não pega.`,
  ].join("\n");
}

export type SobraDaFaculdade = {
  faculdade: string;
  sobraPorTipo: Partial<Record<GoalKind, number>>;
  internosPrecisando: number;
  vagasDeOutras: number;
};

/** null quando não há nada a dizer ao líder. */
export function textoSobraParaLider(s: SobraDaFaculdade): string | null {
  const partes = (Object.entries(s.sobraPorTipo) as [GoalKind, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
  const sobra = partes.length ? (Object.values(s.sobraPorTipo) as number[]).reduce((a, b) => a + b, 0) : 0;
  if (!sobra && !(s.internosPrecisando && s.vagasDeOutras)) return null;
  const linhas = ["Bom dia! Resumo da escala dos próximos 7 dias:"];
  if (sobra) linhas.push(`- A grade da ${s.faculdade} tem ${sobra} turno${sobra === 1 ? "" : "s"} sem ninguém escalado (${partes.join(", ")}).`);
  if (s.internosPrecisando) linhas.push(`- ${s.internosPrecisando} interno${s.internosPrecisando === 1 ? "" : "s"} da ${s.faculdade} ainda têm casinha vazia na meta.`);
  if (s.vagasDeOutras) linhas.push(`- ${s.vagasDeOutras} vaga${s.vagasDeOutras === 1 ? "" : "s"} liberada${s.vagasDeOutras === 1 ? "" : "s"} por outras faculdades estão abertas: dá para escalar quem precisa.`);
  // A liberação automática só cobre USA (auto-release-slots.ts).
  linhas.push(s.sobraPorTipo.USA ? "USA não escalada no prazo vira vaga livre para as outras faculdades. Escale em Montar escala." : "Escale em Montar escala.");
  return linhas.join("\n");
}

export type TrocaAvisada = { base: string; quando: string; quem: string; perfeita: boolean; dar: string | null };

/** Oferta de troca que apareceu num turno em que o interno marcou Quero/Posso. */
export function textoTrocasNosTurnosMarcados(trocas: TrocaAvisada[]) {
  return [
    trocas.length === 1
      ? "Apareceu uma oferta de troca num turno que você marcou no calendário:"
      : "Apareceram ofertas de troca em turnos que você marcou no calendário:",
    ...trocas.map((t) =>
      `- ${t.base}, ${t.quando}, de ${t.quem}${t.dar ? `. Você daria ${t.dar}` : ""}${t.perfeita ? " (troca perfeita: quem ofertou também marcou esse seu turno)" : ""}.`,
    ),
    "Abra Trocas para propor com um toque. A primeira proposta segura a oferta até a pessoa responder.",
  ].join("\n");
}
