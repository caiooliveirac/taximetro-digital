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
    `Sobrou do sorteio da repescagem, ainda sem ninguém, e cabe na sua agenda:`,
    ...vagas.map((v) => `- ${v.baseCode} ${v.quando} (${v.tipo}${v.liberadaPor ? `, liberada pela ${v.liberadaPor}` : ", sem dono"})`),
    `O sorteio já rodou e ninguém inscrito pôde levar: agora você pega direto na aba Extras, sem passar pelo líder. Quem pegar primeiro leva.`,
    `Se ainda falta esse tipo na sua meta, conta na meta; se já fechou, entra como extra — um por interno: quem já teve extra não pega.`,
  ].join("\n");
}

/** Anúncio do sorteio da repescagem (sorteio-repescagem.ts), horas antes. */
export function textoAnuncioSorteio(s: { turno: string; hora: string; vagas: { tipo: GoalKind; n: number }[]; precisa: GoalKind[]; adiado?: boolean }) {
  const total = s.vagas.reduce((n, v) => n + v.n, 0);
  const vagas = `${total} ${total === 1 ? "vaga livre" : "vagas livres"} (${s.vagas.map((v) => `${v.n} ${v.tipo}`).join(", ")})`;
  return [
    s.adiado
      ? `Ninguém tinha se inscrito, então o sorteio da repescagem de **${s.turno}** foi adiado para **${s.hora}**: ${vagas} esperando interessados. Sem inscritos até lá, vão para quem pegar primeiro.`
      : `Sorteio da repescagem **${s.hora}** para **${s.turno}**: ${vagas}.`,
    `A ordem: primeiro quem tem casinha vazia no tipo, depois quem nunca teve extra, por último quem já teve. Empate, o sorteio decide.`,
    s.precisa.length ? `Você ainda tem ${s.precisa.join(" e ")} faltando na meta: se levar, conta.` : "",
    `Para concorrer, inscreva-se em **Extras → Sorteios** até a hora. Inscritos e resultado ficam públicos, e eu te conto aqui como foi.`,
  ].filter(Boolean).join("\n");
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

/** Uma perna da roda como a pessoa lê: "Cabula, ter 10/11 dia". */
export type PernaAvisada = { quem: string; entrega: string; recebe: string; deQuem: string; paraQuem: string };

/** A Dai achou uma troca a três: texto para quem está numa das pontas. */
export function textoRodaSugerida(eu: PernaAvisada & { pediu: boolean }, outros: PernaAvisada[]) {
  const nomes = outros.map((o) => o.quem).join(" e ");
  return [
    `Achei uma troca a três que tira você, ${nomes} dos plantões de que vocês precisam sair:`,
    `- Você entrega ${eu.entrega} para ${eu.paraQuem} e recebe ${eu.recebe}, de ${eu.deQuem}.`,
    ...outros.map((o) => `- ${o.quem} entrega ${o.entrega} para ${o.paraQuem}.`),
    eu.pediu
      ? "Você marcou esse turno que receberia."
      : `Você não marcou ${eu.recebe}; se topar, a roda fecha.`,
    "Abra Trocas, em Troca a três, para propor. Só vale quando os três confirmarem; até lá nada muda na escala.",
  ].join("\n");
}

export function textoRodaProposta(quemPropos: string, eu: PernaAvisada) {
  return [
    `${quemPropos} propôs uma troca a três com você:`,
    `- Você entrega ${eu.entrega} para ${eu.paraQuem} e recebe ${eu.recebe}, de ${eu.deQuem}.`,
    "Abra Trocas, em Troca a três, para confirmar ou recusar. Só vale quando os três confirmarem.",
  ].join("\n");
}

export function textoRodaFechada(eu: PernaAvisada) {
  return `Troca a três feita: você entregou ${eu.entrega} e agora está em ${eu.recebe}. Já está no seu calendário.`;
}

export function textoRodaDesfeita(motivo: string) {
  return `A troca a três de que você fazia parte não vai acontecer: ${motivo} Nada mudou na sua escala.`;
}

/** Reposição de plantão perdido por compromisso da turma (aba Liberações), uma vez por dia. */
export function textoReposicao(r: { perdidos: { quando: string; baseCode: string; titulo: string }[]; faltam: { tipo: GoalKind; n: number }[] }) {
  return [
    r.perdidos.length === 1
      ? `Você saiu do plantão de **${r.perdidos[0].quando}** (${r.perdidos[0].baseCode}) por causa de ${r.perdidos[0].titulo}, e a coordenação marcou para **repor**.`
      : `Você saiu de ${r.perdidos.length} plantões por compromisso da turma (${r.perdidos.map((p) => `${p.quando} ${p.baseCode}`).join(", ")}), e a coordenação marcou para **repor**.`,
    `Ainda falta na sua meta: ${r.faltam.map((f) => `${f.n} ${f.tipo}`).join(" e ")}.`,
    `Inscreva-se nos sorteios da repescagem em **Extras → Sorteios**: quem tem reposição entra na frente. Fechou a meta, a reposição está feita e eu paro de avisar.`,
  ].join("\n");
}
