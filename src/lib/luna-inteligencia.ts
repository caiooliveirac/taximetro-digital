/**
 * Inteligência operacional da Luna: cruza meta, agenda e ofertas e devolve
 * conclusões prontas — o modelo não conta plantão, não confere descanso, não
 * decide se a vaga serve. Tudo aqui é puro (sem banco), para ser testado com
 * fixture: os dados chegam de luna-dados.ts.
 *
 * As regras não moram aqui: descanso vem de rest-policy, casinhas da meta de
 * goal-slots, pendência de presença de pending-attendance. Este arquivo só
 * aplica e classifica.
 */

import { GOAL_KINDS, buildGoalSlots, type GoalKind } from "@/lib/goal-slots";
import { classifyPendingAttendance } from "@/shared/domain/policies/pending-attendance";
import { hasCheckoutDeadlinePassed } from "@/lib/utils";
import { descreveTurno, plantaoSemDescanso, type TurnoDePlantao } from "@/shared/domain/policies/rest-policy";

export type Periodo = "DAY" | "NIGHT";
export type Fonte = "LIBERADA" | "EXTRA" | "GRADE" | "TROCA";
export const FONTES: Fonte[] = ["LIBERADA", "EXTRA", "GRADE", "TROCA"];

export type MeuPlantao = TurnoDePlantao & {
  id: string;
  status: string;
  tipo: GoalKind | null;
  isExtraShift: boolean;
  justificativa: boolean;
  checkinStatus: string | null;
  totpValidatedAt: string | null;
  checkoutAt: string | null;
  checkoutNotes: string | null;
};

export type Meta = {
  faculdade: string | null;
  inicio: string | null;
  fim: string | null;
  alvo: Record<GoalKind, number>;
  faltam: Record<GoalKind, number>;
  realizados: number;
  faltas: number;
};

export type Oferta = {
  fonte: Fonte;
  id: string;
  baseCode: string;
  tipo: GoalKind | null;
  date: string;
  period: Periodo;
  shift: string | null;
  /** TROCA: quem ofereceu. */
  quem?: string;
  quemId?: string;
  /** TROCA: o plantão do colega (para conferir o lado dele). */
  assignmentId?: string | null;
  /** LIBERADA: faculdade que abriu mão; TROCA: faculdade do colega. */
  faculdade?: string | null;
  obs?: string | null;
};

export type Status = "ELIGIBLE" | "REQUIRES_APPROVAL" | "INCOMPATIBLE" | "ALREADY_CLAIMED" | "INSUFFICIENT_DATA";
export type Motivo =
  | "JA_PASSOU"
  | "FORA_DA_JANELA"
  | "TIPO_NAO_PEDIDO"
  | "DIA_BLOQUEADO"
  | "SEM_DESCANSO"
  | "META_DO_TIPO_FECHADA"
  | "FORA_DO_RODIZIO"
  | "NAO_CONTA_PARA_META"
  | "TIPO_DIFERENTE"
  | "SEM_PLANTAO_PARA_OFERECER"
  | "REGRA_DA_TROCA";

export type Bloqueio = { data?: string; diaSemana?: number; periodo?: Periodo };

export type Pedido = {
  /** meta: só o que fecha casinha; plantao: qualquer plantão a mais; troca: largar um plantão meu. */
  objetivo: "meta" | "plantao" | "troca";
  tipos?: GoalKind[];
  fontes?: Fonte[];
  bloqueios?: Bloqueio[];
  preferePeriodo?: Periodo;
  prefereDias?: number[];
  ate: string;
  /** Plantão meu que quero largar (troca). */
  largar?: MeuPlantao | null;
  /** Só reavaliar estas (referências de uma resposta anterior). */
  somente?: { fonte: Fonte; id: string }[];
  /** Tipos com meta completa em que a candidatura a vaga livre está aberta (fila-de-reposicao.ts). */
  candidatura?: GoalKind[];
};

export type Avaliada = Oferta & {
  status: Status;
  motivo: Motivo | null;
  /** Frase pronta do motivo (ou da condição para valer). */
  porque: string;
  contaParaMeta: boolean;
  /** Para TROCA: o plantão meu que dá para oferecer. */
  ofereco?: MeuPlantao | null;
  /** Vaga livre para quem já fechou a meta: é candidatura, a coordenação decide. */
  candidatura?: boolean;
};

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIAS_LONGOS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export const diaDaSemana = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00Z`).getUTCDay();

export function quando(date: string, period: string, shift?: string | null) {
  const d = date.slice(0, 10);
  const [, mes, dia] = d.split("-");
  const turno = shift === "MORNING" ? "manhã" : shift === "AFTERNOON" ? "tarde" : period === "NIGHT" ? "noite" : "dia";
  return `${DIAS[diaDaSemana(d)]} ${dia}/${mes} ${turno}`;
}

const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** Plantões que ainda ocupam o interno (para descanso e troca). */
export const ativos = (meus: MeuPlantao[]) => meus.filter((m) => ["SCHEDULED", "CONFIRMED", "CHECKED_IN"].includes(m.status));

function bloqueado(date: string, period: Periodo, bloqueios: Bloqueio[] = []): Bloqueio | null {
  const dow = diaDaSemana(date);
  return bloqueios.find((b) =>
    (b.data ? b.data === date : true) &&
    (b.diaSemana !== undefined ? b.diaSemana === dow : true) &&
    (b.periodo ? b.periodo === period : true) &&
    (b.data !== undefined || b.diaSemana !== undefined || b.periodo !== undefined),
  ) ?? null;
}

function descreveBloqueio(b: Bloqueio) {
  const dia = b.data ? ddmm(b.data) : b.diaSemana !== undefined ? DIAS_LONGOS[b.diaSemana] : "";
  const turno = b.periodo === "NIGHT" ? " à noite" : b.periodo === "DAY" ? " de dia" : "";
  return `${dia}${turno}`.trim();
}

const APROVACAO: Record<Fonte, string> = {
  LIBERADA: "o líder da sua faculdade escala você",
  EXTRA: "primeiro que pegar, na aba Extras",
  GRADE: "você pede em Trocas → Extra e o líder aprova",
  TROCA: "vale quando o colega confirmar",
};

/**
 * Uma oferta à luz da meta, da agenda e do pedido do interno. A ordem dos
 * testes é a ordem em que o motivo aparece para ele: o mais objetivo primeiro.
 */
export function avaliarOferta(o: Oferta, cx: { meta: Meta | null; meus: MeuPlantao[]; pedido: Pedido; hoje: string }): Avaliada {
  const { meta, pedido, hoje } = cx;
  const largar = pedido.largar ?? null;
  const ocupados = ativos(cx.meus).filter((m) => m.id !== largar?.id);
  const noRodizio = !meta?.fim || o.date <= meta.fim;
  const faltaDoTipo = o.tipo ? (meta?.faltam[o.tipo] ?? 0) : 0;
  const conta = o.fonte !== "EXTRA" && o.fonte !== "TROCA" && Boolean(o.tipo) && noRodizio && faltaDoTipo > 0;
  const fora = (motivo: Motivo, porque: string): Avaliada => ({ ...o, status: "INCOMPATIBLE", motivo, porque, contaParaMeta: conta });

  if (o.date < hoje) return fora("JA_PASSOU", "já passou");
  if (o.date > pedido.ate) return fora("FORA_DA_JANELA", `depois de ${ddmm(pedido.ate)}`);
  if (pedido.tipos?.length && (!o.tipo || !pedido.tipos.includes(o.tipo))) return fora("TIPO_NAO_PEDIDO", `é ${o.tipo ?? "outro tipo"}`);
  const b = bloqueado(o.date, o.period, pedido.bloqueios);
  if (b) return fora("DIA_BLOQUEADO", `você não pode ${descreveBloqueio(b)}`);
  const choque = plantaoSemDescanso({ date: o.date, period: o.period, shift: o.shift, baseCode: o.baseCode }, ocupados);
  if (choque) return fora("SEM_DESCANSO", `sem 12h de descanso por causa do seu ${descreveTurno(choque)}`);

  if (o.fonte === "LIBERADA" && faltaDoTipo <= 0) {
    if (pedido.objetivo !== "meta" && o.tipo && pedido.candidatura?.includes(o.tipo)) {
      return { ...o, status: "REQUIRES_APPROVAL", motivo: null, porque: "candidatura: a coordenação decide (sua meta do tipo já fechou)", contaParaMeta: false, candidatura: true };
    }
    return fora("META_DO_TIPO_FECHADA", `vaga liberada é só para quem ainda tem ${o.tipo} faltando na meta`);
  }

  let ofereco: MeuPlantao | null = null;
  if (o.fonte === "TROCA") {
    if (largar) {
      if (largar.tipo !== o.tipo) return fora("TIPO_DIFERENTE", `troca é do mesmo tipo e seu plantão é ${largar.tipo ?? "de outro tipo"}`);
      ofereco = largar;
    } else {
      // Algum plantão meu do mesmo tipo que eu possa entregar sem ficar sem descanso.
      ofereco = ocupados.find((m) =>
        m.tipo === o.tipo && !m.isExtraShift && m.date >= hoje && ["SCHEDULED", "CONFIRMED"].includes(m.status) &&
        !plantaoSemDescanso({ date: o.date, period: o.period, shift: o.shift, baseCode: o.baseCode }, ocupados.filter((x) => x.id !== m.id)),
      ) ?? null;
      if (!ofereco) return fora("SEM_PLANTAO_PARA_OFERECER", `você não tem ${o.tipo} futuro para dar em troca`);
    }
  }

  if (pedido.objetivo === "meta") {
    if (o.fonte === "EXTRA" || o.fonte === "TROCA") return fora("NAO_CONTA_PARA_META", o.fonte === "EXTRA" ? "extra não conta para a meta" : "troca não aumenta a meta");
    if (!noRodizio) return fora("FORA_DO_RODIZIO", `depois do fim do seu rodízio (${ddmm(meta!.fim!)})`);
    if (faltaDoTipo <= 0) return fora("META_DO_TIPO_FECHADA", `sua meta de ${o.tipo} já está completa`);
  }

  const avisos: string[] = [APROVACAO[o.fonte]];
  if (o.fonte === "EXTRA") avisos.push("não conta para a meta");
  else if (o.fonte !== "TROCA" && !conta) avisos.push(noRodizio ? "não ajuda a meta (tipo já completo)" : "depois do fim do rodízio");
  if (ofereco && !largar) avisos.push(`você daria o ${descreveTurno(ofereco)}`);
  return {
    ...o,
    status: o.fonte === "EXTRA" ? "ELIGIBLE" : "REQUIRES_APPROVAL",
    motivo: null,
    porque: avisos.join("; "),
    contaParaMeta: conta,
    ofereco,
  };
}

/**
 * Ordem explícita: sem aprovação antes de com aprovação; o que fecha meta
 * antes do que não fecha; turno preferido; dia preferido; data mais próxima.
 */
export function ordenar(lista: Avaliada[], pedido: Pick<Pedido, "preferePeriodo" | "prefereDias">) {
  const chave = (a: Avaliada) => [
    a.status === "ELIGIBLE" ? 0 : 1,
    a.contaParaMeta ? 0 : 1,
    pedido.preferePeriodo && a.period !== pedido.preferePeriodo ? 1 : 0,
    pedido.prefereDias?.length && !pedido.prefereDias.includes(diaDaSemana(a.date)) ? 1 : 0,
  ];
  return [...lista].sort((a, b) => {
    const ka = chave(a);
    const kb = chave(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return `${a.date}${a.period === "DAY" ? 0 : 1}${a.baseCode}`.localeCompare(`${b.date}${b.period === "DAY" ? 0 : 1}${b.baseCode}`);
  });
}

/**
 * Combinação que fecha a meta: pega na ordem do ranking, um por casinha
 * vazia, sem dois turnos que se atropelem entre si nem com a agenda.
 */
export function montarPlano(ordenadas: Avaliada[], faltam: Record<GoalKind, number>, meus: MeuPlantao[]) {
  const precisa = { ...faltam };
  const escolhidos: Avaliada[] = [];
  const ocupados: TurnoDePlantao[] = [...ativos(meus)];
  for (const a of ordenadas) {
    if (!a.contaParaMeta || !a.tipo || (precisa[a.tipo] ?? 0) <= 0) continue;
    const turno = { date: a.date, period: a.period, shift: a.shift, baseCode: a.baseCode };
    if (plantaoSemDescanso(turno, ocupados)) continue;
    escolhidos.push(a);
    ocupados.push(turno);
    precisa[a.tipo] -= 1;
  }
  return { escolhidos, aindaFaltam: precisa };
}

export type Busca = {
  status: "META_COMPLETA" | "OPPORTUNITIES_FOUND" | "PARTIAL" | "NO_OPTIONS" | "INSUFFICIENT_DATA";
  objetivo: Pedido["objetivo"];
  faltam: Record<GoalKind, number> | null;
  fimRodizio: string | null;
  /** Compatíveis, na ordem em que aparecem (plano primeiro). */
  opcoes: Avaliada[];
  plano: Avaliada[];
  aindaFaltam: Record<GoalKind, number> | null;
  totalCompativeis: number;
  precisamAprovacao: number;
  descartes: { motivo: Motivo; n: number; exemplo: string }[];
  /** Ofertas pedidas pelo número que não estão mais abertas. */
  sumiram: number;
  avisos: string[];
};

export function buscarOpcoes(ofertas: Oferta[], cx: { meta: Meta | null; meus: MeuPlantao[]; pedido: Pedido; hoje: string }): Busca {
  const { meta, pedido } = cx;
  const faltamPedidos = meta
    ? Object.fromEntries(GOAL_KINDS.map((k) => [k, pedido.tipos?.length && !pedido.tipos.includes(k) ? 0 : meta.faltam[k]])) as Record<GoalKind, number>
    : null;
  const somente = pedido.somente?.length ? new Set(pedido.somente.map((s) => `${s.fonte}|${s.id}`)) : null;
  const universo = somente ? ofertas.filter((o) => somente.has(`${o.fonte}|${o.id}`)) : ofertas;

  const avaliadas = universo.map((o) => avaliarOferta(o, cx));
  const boas = ordenar(avaliadas.filter((a) => a.status === "ELIGIBLE" || a.status === "REQUIRES_APPROVAL"), pedido);
  const ruins = avaliadas.filter((a) => a.status === "INCOMPATIBLE");

  const porMotivo = new Map<Motivo, { n: number; exemplo: string }>();
  for (const r of ruins) {
    // Tipo não pedido e fora da janela não são "descartes" para o interno: ele mesmo recortou.
    // Extra fora da meta já vira aviso próprio.
    if (r.motivo === "TIPO_NAO_PEDIDO" || r.motivo === "FORA_DA_JANELA" || r.motivo === "JA_PASSOU" || r.motivo === "NAO_CONTA_PARA_META") continue;
    const atual = porMotivo.get(r.motivo!) ?? { n: 0, exemplo: `${r.baseCode} ${quando(r.date, r.period, r.shift)}: ${r.porque}` };
    atual.n += 1;
    porMotivo.set(r.motivo!, atual);
  }

  const { escolhidos, aindaFaltam } = pedido.objetivo === "meta" && faltamPedidos
    ? montarPlano(boas, faltamPedidos, cx.meus)
    : { escolhidos: [] as Avaliada[], aindaFaltam: null };
  const resto = boas.filter((b) => !escolhidos.includes(b));

  const avisos: string[] = [];
  if (!meta) avisos.push("Não achei sua meta (sem rodízio ativo?) — não dá para saber o que conta.");
  if (pedido.objetivo === "meta") {
    const extras = avaliadas.filter((a) => a.fonte === "EXTRA" && a.motivo === "NAO_CONTA_PARA_META").length;
    if (extras) avisos.push(`Há ${extras} extra(s) aberto(s), mas extra não conta para a meta.`);
  }

  let status: Busca["status"];
  const somaFaltam = faltamPedidos ? GOAL_KINDS.reduce((s, k) => s + faltamPedidos[k], 0) : 0;
  if (pedido.objetivo === "meta") {
    if (!meta) status = "INSUFFICIENT_DATA";
    else if (somaFaltam === 0) status = "META_COMPLETA";
    else if (escolhidos.length === 0) status = "NO_OPTIONS";
    else status = GOAL_KINDS.every((k) => aindaFaltam![k] <= 0) ? "OPPORTUNITIES_FOUND" : "PARTIAL";
  } else {
    status = boas.length ? "OPPORTUNITIES_FOUND" : "NO_OPTIONS";
  }

  if ((pedido.fontes ?? []).includes("GRADE") && (status === "PARTIAL" || status === "NO_OPTIONS")) {
    avisos.push("A sobra da grade da faculdade só aparece para os próximos 10 dias (até o fim do seu rodízio) — vale perguntar de novo daqui a uns dias.");
  }

  return {
    status,
    objetivo: pedido.objetivo,
    faltam: faltamPedidos,
    fimRodizio: meta?.fim ?? null,
    opcoes: [...escolhidos, ...resto],
    plano: escolhidos,
    aindaFaltam,
    totalCompativeis: boas.length,
    precisamAprovacao: boas.filter((b) => b.status === "REQUIRES_APPROVAL").length,
    descartes: [...porMotivo.entries()].map(([motivo, v]) => ({ motivo, ...v })).sort((a, b) => b.n - a.n),
    sumiram: somente ? somente.size - universo.length : 0,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Texto pronto. O interno quer saber o que fazer; nada de tabela nem código.

const ROTULO_FONTE: Record<Fonte, string> = { LIBERADA: "vaga liberada", EXTRA: "extra", GRADE: "sobra da grade", TROCA: "troca" };

export function faltamEmTexto(faltam: Record<GoalKind, number>) {
  const partes = GOAL_KINDS.filter((k) => faltam[k] > 0).map((k) => `${faltam[k]} ${k}`);
  if (!partes.length) return "nada";
  return partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}`;
}

export function linhaDaOpcao(a: Avaliada, n: number) {
  const origem = a.fonte === "TROCA" ? `troca com ${a.quem ?? "colega"}${a.faculdade ? ` (${a.faculdade})` : ""}` : a.fonte === "LIBERADA" ? (a.faculdade ? `liberada por ${a.faculdade}` : "vaga sem dono") : ROTULO_FONTE[a.fonte];
  return `${n}. **${a.baseCode} ${quando(a.date, a.period, a.shift)}** (${a.tipo ?? "?"}) · ${origem} — ${a.porque}`;
}

export const MOSTRAR = 5;

export function textoDaBusca(b: Busca): string {
  const linhas: string[] = [];
  const fim = b.fimRodizio ? ` até ${ddmm(b.fimRodizio)} (fim do rodízio)` : "";
  if (b.sumiram) linhas.push(b.sumiram === 1 ? "Essa opção não está mais aberta — alguém já pegou ou ela saiu da lista." : `${b.sumiram} dessas opções não estão mais abertas.`);

  if (b.objetivo === "meta") {
    if (b.status === "INSUFFICIENT_DATA") linhas.push("Não consegui achar sua meta, então não sei o que conta. Confira a aba Início ou fale com o líder.");
    else if (b.status === "META_COMPLETA") linhas.push("Sua meta já está completa nesse tipo — nada a fechar. Plantão a mais só como extra ou sobra da grade.");
    else {
      if (b.status === "OPPORTUNITIES_FOUND") linhas.push(`Dá para fechar${fim}: ${b.plano.length === 1 ? "esta opção cobre" : `estas ${b.plano.length} opções cobrem`} o que falta, sem quebrar seu descanso.`);
      else if (b.status === "PARTIAL") linhas.push(`Dá para avançar${fim}, mas ainda ficariam faltando ${faltamEmTexto(b.aindaFaltam!)}.`);
      else linhas.push("Não achei agora nenhuma vaga que conte para a sua meta e caiba na sua agenda.");
    }
  } else if (b.status === "NO_OPTIONS") {
    linhas.push(b.objetivo === "troca" ? "Não achei oferta de troca que sirva para você agora." : "Não achei nada que caiba na sua agenda agora.");
  } else {
    linhas.push(`Achei ${b.totalCompativeis} ${b.totalCompativeis === 1 ? "opção compatível" : "opções compatíveis"}${b.precisamAprovacao ? ` (${b.precisamAprovacao} dependem de aprovação)` : ""}.`);
  }

  b.opcoes.slice(0, MOSTRAR).forEach((a, i) => linhas.push(`- ${linhaDaOpcao(a, i + 1)}`));
  if (b.opcoes.length > MOSTRAR) linhas.push(`(+${b.opcoes.length - MOSTRAR} outras compatíveis)`);

  const descartadas = b.descartes.reduce((s, d) => s + d.n, 0);
  if (descartadas) {
    const top = b.descartes.slice(0, 3).map((d) => `${d.n} ${ROTULO_MOTIVO[d.motivo]}`).join(", ");
    linhas.push(`Deixei de fora ${descartadas}: ${top}.`);
  }
  linhas.push(...b.avisos);
  return linhas.join("\n");
}

const ROTULO_MOTIVO: Record<Motivo, string> = {
  JA_PASSOU: "que já passaram",
  FORA_DA_JANELA: "fora da janela",
  TIPO_NAO_PEDIDO: "de outro tipo",
  DIA_BLOQUEADO: "em dia que você não pode",
  SEM_DESCANSO: "sem 12h de descanso",
  META_DO_TIPO_FECHADA: "de tipo com meta completa",
  FORA_DO_RODIZIO: "depois do fim do rodízio",
  NAO_CONTA_PARA_META: "que não contam para a meta",
  TIPO_DIFERENTE: "de outro tipo que o seu plantão",
  SEM_PLANTAO_PARA_OFERECER: "sem plantão seu do mesmo tipo para dar",
  REGRA_DA_TROCA: "barradas pelo lado do colega (descanso, cota de CRU ou pedido pendente)",
};

// ---------------------------------------------------------------------------
// Resumo, agenda, presença e "por que não contou".

/** `janela`: "hoje", "amanhã"… quando a pergunta é de um dia só. */
export function textoDaAgenda(meus: MeuPlantao[], de: string, ate: string | null, janela?: string) {
  const lista = ativos(meus).filter((m) => m.date >= de && (!ate || m.date <= ate)).slice(0, 8);
  if (!lista.length) return janela ? `Você não tem plantão ${janela}.` : "Você não tem plantão marcado daqui para frente.";
  return [
    janela ? `Seu plantão ${janela}:` : "Seus próximos plantões:",
    ...lista.map((m) => `- **${m.baseCode} ${quando(m.date, m.period, m.shift)}** (${m.tipo ?? "?"}${m.isExtraShift ? ", extra" : ""})`),
  ].join("\n");
}

/**
 * Presença em aberto: só conta como pendente depois do prazo de checkout do
 * turno (o mesmo corte das casinhas da meta) — plantão em andamento não é
 * pendência.
 */
export function pendenciasDePresenca(meus: MeuPlantao[], hoje: string, inicio: string | null, now: Date = new Date()) {
  return meus
    .filter((m) => m.date <= hoje && (!inicio || m.date >= inicio) && hasCheckoutDeadlinePassed(m.date, m.period, now))
    .map((m) => ({ m, falta: classifyPendingAttendance({ status: m.status, isExtraShift: m.isExtraShift, checkinStatus: m.checkinStatus, totpValidatedAt: m.totpValidatedAt, checkoutAt: m.checkoutAt, checkoutNotes: m.checkoutNotes }) }))
    .filter((x) => x.falta);
}

export function textoDaPresenca(meus: MeuPlantao[], hoje: string, inicio: string | null, now: Date = new Date()) {
  const p = pendenciasDePresenca(meus, hoje, inicio, now);
  const andamento = meus.filter((m) => m.status === "CHECKED_IN" && m.date <= hoje && !hasCheckoutDeadlinePassed(m.date, m.period, now));
  const checkout = p.filter((x) => x.falta === "CHECKOUT");
  const checkin = p.filter((x) => x.falta === "CHECKIN" && x.m.status !== "ABSENT");
  const faltas = meus.filter((m) => m.status === "ABSENT" && m.date <= hoje && (!inicio || m.date >= inicio) && !checkout.some((c) => c.m.id === m.id));
  const linhas: string[] = [];
  if (!checkout.length && !checkin.length) linhas.push("Nenhum checkout pendente: todo plantão que já terminou está fechado.");
  for (const m of andamento) linhas.push(`Em andamento: **${m.baseCode} ${quando(m.date, m.period, m.shift)}** — check-in feito; o checkout é no fim do turno.`);
  if (checkout.length) {
    linhas.push(`Checkout pendente em ${checkout.length}:`);
    for (const { m } of checkout.slice(0, 5)) linhas.push(`- **${m.baseCode} ${quando(m.date, m.period, m.shift)}** — ${m.status === "ABSENT" ? "check-in validado, mas virou falta automática sem checkout; o preceptor corrige em Pendências" : "check-in validado e sem checkout; peça ao preceptor"}`);
  }
  if (checkin.length) {
    linhas.push(`Sem check-in validado em ${checkin.length}:`);
    for (const { m } of checkin.slice(0, 5)) linhas.push(`- **${m.baseCode} ${quando(m.date, m.period, m.shift)}**`);
  }
  if (faltas.length) {
    const semJust = faltas.filter((f) => !f.justificativa).length;
    linhas.push(`Faltas no rodízio: ${faltas.length}${semJust ? ` (${semJust} sem justificativa — dá para justificar no calendário)` : " (todas justificadas)"}.`);
  }
  return linhas.join("\n");
}

/** "Por que esse plantão não contou?" — a casinha que ele ocupa e o porquê. */
export function explicarPlantao(m: MeuPlantao, meta: Meta | null, hoje: string, now: Date = new Date()) {
  const nome = `${m.baseCode} ${quando(m.date, m.period, m.shift)}`;
  if (m.status === "CANCELLED") return `${nome}: foi cancelado (troca ou remoção), então não está na sua meta.`;
  if (m.isExtraShift) return `${nome}: é extra — extra não conta para a meta.`;
  if (!m.tipo) return `${nome}: essa base não entra em nenhum tipo da meta.`;
  if (meta?.inicio && m.date < meta.inicio) return `${nome}: é de antes do início do seu rodízio (${ddmm(meta.inicio)}), não entra na meta atual.`;
  if (meta?.fim && m.date > meta.fim) return `${nome}: é depois do fim do rodízio (${ddmm(meta.fim)}), não entra nesta meta.`;
  const [slot] = buildGoalSlots([{ ...m, baseType: m.tipo === "CRU" ? "CENTRAL" : m.tipo }], m.tipo, 0, hoje, now);
  switch (slot?.state) {
    case "done":
      return `${nome}: contou — ${m.status === "EXCUSED" ? "falta abonada conta como feito" : "realizado com checkout"} (${m.tipo}).`;
    case "ongoing":
      return `${nome}: está em andamento e já ocupa a casinha de ${m.tipo}.`;
    case "scheduled":
      return `${nome}: agendado — já ocupa a casinha de ${m.tipo}; vira realizado com o checkout.`;
    case "pending":
      return `${nome}: o prazo do checkout passou sem checkout, por isso não conta. ${m.checkinStatus === "VALIDATED" ? "Teve check-in: peça ao preceptor para fechar." : "Sem check-in validado: fale com o preceptor."}`;
    case "missed":
      return `${nome}: ficou como falta — falta não ocupa casinha. ${m.justificativa ? "Sua justificativa foi enviada; conta se for abonada." : "Dá para justificar no calendário; conta se for abonada."}`;
    default:
      return `${nome}: não consegui classificar esse plantão.`;
  }
}

/** Resumo curto para o modelo: só o que responde as perguntas de agenda e meta. */
export function resumoParaModelo(meta: Meta | null, meus: MeuPlantao[], hoje: string) {
  const proximos = ativos(meus).filter((m) => m.date >= hoje).slice(0, 10);
  return JSON.stringify({
    hoje,
    rodizio: meta ? { inicio: meta.inicio, fim: meta.fim } : null,
    pendencias_presenca: pendenciasDePresenca(meus, hoje, meta?.inicio ?? null).length,
    proximos: proximos.map((m) => ({ data: m.date, quando: quando(m.date, m.period, m.shift), base: m.baseCode, tipo: m.tipo, ...(m.isExtraShift ? { extra: true } : {}) })),
  });
}
