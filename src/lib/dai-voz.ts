/**
 * Voz do Dai nas respostas que saem direto do banco, sem modelo: o mesmo fato
 * dito de cinco jeitos, para a conversa não soar como formulário.
 *
 * `voz` é sorteada por pergunta na rota; sem ela (testes, avisos) sai sempre a
 * primeira forma. Só muda a frase em volta — números, datas e regras são os
 * mesmos em todas.
 */

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const escolher = <T,>(voz: string | undefined, chave: string, formas: T[]): T => (voz ? formas[hash(`${voz}|${chave}`) % formas.length] : formas[0]);

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

export const voz = {
  metaNaTela: (v?: string) =>
    escolher(v, "metaNaTela", [
      "Sua meta, tipo por tipo, está na tela **Início**. Aqui eu procuro o que fecha ela: pergunte \"que vagas fecham minha meta?\".",
      "O placar da meta, tipo por tipo, fica na tela **Início**. Meu trabalho é achar o que fecha ela — pergunte \"que vagas fecham minha meta?\".",
      "Suas casinhas estão na **Início**, sempre atualizadas. Se quiser, eu procuro vagas que completam: \"que vagas fecham minha meta?\".",
      "A contagem da meta mora na tela **Início**. Aqui eu caço o que falta: é só pedir \"que vagas fecham minha meta?\".",
      "Dá uma olhada na **Início**: lá está a meta de cada tipo. Para achar vaga que fecha, me pergunte \"que vagas fecham minha meta?\".",
    ]),

  agenda: (v: string | undefined, janela?: string) =>
    janela
      ? escolher(v, "agendaDia", [
          `Seu plantão ${janela}:`,
          `${maiuscula(janela)} você está escalado em:`,
          `Conferi: ${janela} tem plantão.`,
          `Sim, ${janela} tem turno seu:`,
          `Olhei a escala de ${janela}:`,
        ])
      : escolher(v, "agenda", [
          "Seus próximos plantões:",
          "Olhei sua escala. Vem aí:",
          "Pela escala, o que vem pela frente:",
          "Anotado na sua agenda:",
          "Conferi aqui — seus próximos turnos:",
        ]),

  semAgenda: (v: string | undefined, janela?: string) =>
    janela
      ? escolher(v, "semAgendaDia", [
          `Você não tem plantão ${janela}.`,
          `${maiuscula(janela)} está livre: nenhum plantão seu na escala.`,
          `Conferi a escala — ${janela} você não está em nenhum turno.`,
          `Nada marcado ${janela}. Dia livre.`,
          `Sem plantão ${janela} na sua escala.`,
        ])
      : escolher(v, "semAgenda", [
          "Você não tem plantão marcado daqui para frente.",
          "Sua agenda está vazia daqui para frente — nenhum turno marcado.",
          "Conferi a escala: não há plantão seu marcado a partir de hoje.",
          "Nada na sua escala daqui pra frente.",
          "Não achei plantão seu marcado para os próximos dias.",
        ]),

  presencaOk: (v?: string) =>
    escolher(v, "presencaOk", [
      "Nenhum checkout pendente: todo plantão que já terminou está fechado.",
      "Tudo em dia: cada plantão que terminou já tem checkout.",
      "Conferi seus turnos encerrados — nenhum ficou sem checkout.",
      "Presença limpa. Nenhum checkout em aberto.",
      "Nada pendente: todos os plantões terminados estão fechados.",
    ]),

  /** `tipos`: "de USA e CRU " ou "". */
  metaCompleta: (v: string | undefined, tipos: string) =>
    escolher(v, "metaCompleta", [
      `Sua meta ${tipos}já está toda marcada — não há casinha vazia para fechar. Plantão a mais? Pergunte "tem extra aberto?" ou "sobrou vaga na grade?".`,
      `Meta ${tipos}fechada: todas as casinhas já têm plantão. Se quiser mais, pergunte "tem extra aberto?" ou "sobrou vaga na grade?".`,
      `Nada a fechar — sua meta ${tipos}está completa. Quer plantão a mais? Pergunte "tem extra aberto?" ou "sobrou vaga na grade?".`,
      `Você já completou a meta ${tipos}: nenhuma casinha vazia. Para ir além, pergunte "tem extra aberto?" ou "sobrou vaga na grade?".`,
      `Casinhas ${tipos}todas preenchidas. Plantão a mais vem por "tem extra aberto?" ou "sobrou vaga na grade?".`,
    ]),

  /** `fim`: " até 30/11 (fim do rodízio)" ou "". */
  fechaMeta: (v: string | undefined, fim: string, n: number) =>
    escolher(v, "fechaMeta", [
      `Dá para fechar${fim}: ${plural(n, "esta opção cobre", `estas ${n} opções cobrem`)} o que falta, sem quebrar seu descanso.`,
      `Boa notícia: ${plural(n, "uma opção fecha", `${n} opções fecham`)} sua meta${fim}, respeitando o descanso.`,
      `Achei o caminho${fim}: ${plural(n, "esta opção cobre", `estas ${n} cobrem`)} tudo o que falta, sem bater descanso.`,
      `Sua meta fecha${fim} com ${plural(n, "esta opção", `estas ${n} opções`)}, respeitando as 12h de descanso.`,
      `Montei um plano${fim}: ${plural(n, "uma vaga resolve", `${n} vagas resolvem`)} o que falta, sem quebrar seu descanso.`,
    ]),

  parcial: (v: string | undefined, fim: string, falta: string) =>
    escolher(v, "parcial", [
      `Dá para avançar${fim}, mas ainda ficariam faltando ${falta}.`,
      `Consigo te adiantar${fim}, mas não fecha tudo: ainda faltariam ${falta}.`,
      `Fecha uma parte${fim}. Mesmo pegando tudo, sobram ${falta} em aberto.`,
      `Ajuda, mas não completa${fim}: ficariam faltando ${falta}.`,
      `Avança${fim}, só que ${falta} ainda ficariam sem vaga.`,
    ]),

  semMeta: (v?: string) =>
    escolher(v, "semMeta", [
      "Não achei agora nenhuma vaga que conte para a sua meta e caiba na sua agenda.",
      "Por enquanto nenhuma vaga que conte para a meta cabe na sua agenda.",
      "Procurei, mas nada aberto agora conta para a meta e cabe nos seus horários.",
      "Agora não tem vaga que some na sua meta sem bater com sua agenda.",
      "Varri as vagas abertas: nenhuma conta para a meta e encaixa na sua agenda hoje.",
    ]),

  semTroca: (v?: string) =>
    escolher(v, "semTroca", [
      "Não achei oferta de troca que sirva para você agora.",
      "Nenhuma oferta de troca encaixa com você no momento.",
      "Olhei as trocas abertas — nenhuma serve para os seus plantões agora.",
      "Por ora, nenhuma troca compatível com você.",
      "Sem troca que sirva agora. Ofertas novas aparecem em Trocas.",
    ]),

  semNada: (v?: string) =>
    escolher(v, "semNada", [
      "Não achei nada que caiba na sua agenda agora.",
      "Nada aberto agora encaixa nos seus horários.",
      "Procurei e não tem vaga que caiba na sua agenda no momento.",
      "Por enquanto nada compatível com a sua agenda.",
      "Olhei tudo que está aberto: nada encaixa com você agora.",
    ]),

  /** `aprov`: " (2 dependem de aprovação)" ou "". */
  achei: (v: string | undefined, n: number, aprov: string) =>
    escolher(v, "achei", [
      `Achei ${n} ${plural(n, "opção compatível", "opções compatíveis")}${aprov}.`,
      `${plural(n, "Tem uma opção que encaixa", `Tem ${n} opções que encaixam`)} na sua agenda${aprov}.`,
      `Separei ${plural(n, "uma opção que cabe", `${n} opções que cabem`)} no seu descanso e na sua agenda${aprov}.`,
      `Olha só: ${plural(n, "1 opção compatível", `${n} opções compatíveis`)}${aprov}.`,
      `Encontrei ${plural(n, "uma opção", `${n} opções`)} para você${aprov}.`,
    ]),
};
