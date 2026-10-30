/**
 * Ferramentas da Luna do interno, orientadas à intenção: cada uma cruza as
 * fontes no backend (luna-dados) com as regras (luna-inteligencia) e devolve
 * a resposta PRONTA — texto, cartões com ação e a memória da conversa. O
 * modelo só escolhe a ferramenta e traduz o pedido em parâmetros; não conta,
 * não filtra, não confere descanso.
 *
 * Todas só LEEM. A Luna nunca escreve: aponta a tela ou a conversa onde o
 * interno age, e a ação passa pelo caso de uso oficial, que revalida tudo.
 */

import { GOAL_KINDS, type GoalKind } from "@/lib/goal-slots";
import type { Fontes, LunaCtx } from "@/lib/luna-dados";
import {
  FONTES, MOSTRAR, ativos, avaliarOferta, buscarOpcoes, ddmm, descreveBloqueio, explicarPlantao, linhaDaOpcao, linhaDaSolicitacao, quando, textoDaBusca,
  type Avaliada, type Bloqueio, type Busca, type Fonte, type Meta, type MeuPlantao, type Oferta, type Pedido, type Periodo, type Solicitacao,
} from "@/lib/luna-inteligencia";
import { addDaysToDateStr, getBrazilNowParts } from "@/lib/utils";
import { baseETurno, inicioDoTurno, textoDaBaseAgora, turnoPedido } from "@/lib/luna-base-agora";
import { candidaturaAberta } from "@/features/extra-offers/application/fila-de-reposicao";
import { aberturaDaRepescagem } from "@/features/extra-offers/application/repescagem";

export type { LunaCtx } from "@/lib/luna-dados";

/** Cartões que a tela monta a partir do resultado das ferramentas (não do texto do modelo). */
export type LunaItem = {
  titulo: string;
  detalhe?: string;
  href?: string;
  acao?: string;
  mapa?: string;
  /** id da vaga livre: botão que abre a candidatura. */
  candidatar?: string;
  /** Com estes, a tela desenha data, turno e tipo como selos; `titulo` fica para conversas antigas. */
  quando?: { data: string; periodo: string; turno?: string | null };
  base?: string;
  tipoVaga?: string | null;
  numero?: number;
};
/** Meta tipo por tipo: casinhas marcadas, vazias e quantas a busca cobre. */
export type LunaCasinhas = { tipo: GoalKind; alvo: number; marcadas: number; cobre: number }[];
export type LunaCartao = {
  tipo: "opcoes" | "troca" | "plantoes" | "guia" | "previsao";
  titulo: string;
  itens: LunaItem[];
  verTudo?: { href: string; rotulo: string };
  casinhas?: LunaCasinhas;
  /** Guia: fechado quando há opções na tela, aberto quando não há. */
  aberto?: boolean;
};

/** Opção numerada mostrada ao interno: é por ela que "a segunda" volta a ser um id. */
export type LunaRef = { n: number; fonte: Fonte; id: string };
/** Memória conversacional: só referências e parâmetros, nunca o estado da vaga. */
export type LunaMemoria = { busca?: ArgsBusca; opcoes?: LunaRef[] };

/** Mensagem que a rota manda ao líder (só ela escreve no banco); `feito`/`falhou` completam o texto ao interno. */
export type AvisoAoLider = { para: string; ids: string[]; itens: string[]; feito: string; falhou: string };

export type Resultado = {
  texto: string;
  aviso?: AvisoAoLider;
  cartao?: LunaCartao;
  /** O que pode cair na repescagem e quando (preverRepescagem). */
  previsao?: LunaCartao;
  /** Explicação da regra, ao lado do cartão (ex.: o jogo dos extras). */
  guia?: LunaCartao;
  memoria?: LunaMemoria;
  /** Para o log: o desfecho e quantos registros a ferramenta olhou. */
  status: string;
  registros: number;
};

export const turnoCurto = quando;

// ---------------------------------------------------------------------------
// Parâmetros vindos do modelo: tudo é saneado aqui, nada é confiado.

export type ArgsBusca = {
  objetivo?: "meta" | "plantao" | "troca";
  tipos?: GoalKind[];
  fontes?: Fonte[];
  nao_posso?: { dia_semana?: string; data?: string; periodo?: string }[];
  /** Só estes dias: o que ele disse que pode ou quer ("dia 09/11 tem?"). */
  datas?: { data: string; periodo?: string }[];
  prefere_periodo?: string;
  prefere_dias_semana?: string[];
  dias?: number;
  trocar_data?: string;
  trocar_periodo?: string;
  opcoes?: number[];
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const DIA_IDX: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };

export function lerDiaSemana(v: unknown): number | undefined {
  if (typeof v === "number" && v >= 0 && v <= 6) return v;
  if (typeof v !== "string") return undefined;
  return DIA_IDX[semAcento(v).trim().slice(0, 3)];
}

export function lerPeriodo(v: unknown): Periodo | undefined {
  if (typeof v !== "string") return undefined;
  const s = semAcento(v);
  if (s.startsWith("noit") || s.startsWith("notur") || s === "night") return "NIGHT";
  if (s.startsWith("dia") || s.startsWith("diur") || s === "day") return "DAY";
  return undefined;
}

const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, 14) : []);
const lerTipos = (v: unknown) => lista(v).map((t) => String(t).toUpperCase()).filter((t): t is GoalKind => (GOAL_KINDS as readonly string[]).includes(t));
const lerFontes = (v: unknown) => lista(v).map((f) => String(f).toUpperCase()).filter((f): f is Fonte => (FONTES as string[]).includes(f));

/** Só os campos conhecidos, com o tipo certo — é o que vai para a memória. */
export function sanearArgs(raw: Record<string, unknown>): ArgsBusca {
  const a: ArgsBusca = {};
  if (raw.objetivo === "meta" || raw.objetivo === "plantao" || raw.objetivo === "troca") a.objetivo = raw.objetivo;
  const tipos = lerTipos(raw.tipos);
  if (tipos.length) a.tipos = tipos;
  const fontes = lerFontes(raw.fontes);
  if (fontes.length) a.fontes = fontes;
  const np = lista(raw.nao_posso)
    .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
    .map((b) => ({
      ...(lerDiaSemana(b.dia_semana) !== undefined ? { dia_semana: String(b.dia_semana) } : {}),
      ...(typeof b.data === "string" && DATA.test(b.data) ? { data: b.data } : {}),
      ...(lerPeriodo(b.periodo) ? { periodo: String(b.periodo) } : {}),
    }))
    .filter((b) => Object.keys(b).length);
  if (np.length) a.nao_posso = np;
  const ds = lista(raw.datas)
    .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object" && typeof (b as Record<string, unknown>).data === "string" && DATA.test(String((b as Record<string, unknown>).data)))
    .map((b) => ({ data: String(b.data), ...(lerPeriodo(b.periodo) ? { periodo: String(b.periodo) } : {}) }));
  if (ds.length) a.datas = ds;
  if (lerPeriodo(raw.prefere_periodo)) a.prefere_periodo = String(raw.prefere_periodo);
  const pd = lista(raw.prefere_dias_semana).filter((d) => lerDiaSemana(d) !== undefined).map(String);
  if (pd.length) a.prefere_dias_semana = pd;
  if (Number.isFinite(Number(raw.dias)) && Number(raw.dias) > 0) a.dias = Math.min(Math.round(Number(raw.dias)), 45);
  if (typeof raw.trocar_data === "string" && DATA.test(raw.trocar_data)) a.trocar_data = raw.trocar_data;
  if (lerPeriodo(raw.trocar_periodo)) a.trocar_periodo = String(raw.trocar_periodo);
  const op = lista(raw.opcoes).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 20);
  if (op.length) a.opcoes = op;
  return a;
}

function bloqueios(a: ArgsBusca): Bloqueio[] {
  return (a.nao_posso ?? []).map((b) => ({
    ...(b.data ? { data: b.data } : {}),
    ...(lerDiaSemana(b.dia_semana) !== undefined ? { diaSemana: lerDiaSemana(b.dia_semana) } : {}),
    ...(lerPeriodo(b.periodo) ? { periodo: lerPeriodo(b.periodo) } : {}),
  }));
}

/** Meu plantão por data (e turno, se dito). Mais de um no dia sem turno: ambíguo. */
export function acharMeu(meus: MeuPlantao[], hoje: string, data: string, periodo?: Periodo) {
  const doDia = ativos(meus).filter((m) => m.date === data && m.date >= hoje && (!periodo || m.period === periodo));
  return doDia;
}

// ---------------------------------------------------------------------------
// Cartões

function acaoDa(a: Avaliada, lider: { id: string; nome: string } | null): Pick<LunaItem, "href" | "acao" | "candidatar"> {
  const q = quando(a.date, a.period, a.shift);
  if (a.candidatura) return { candidatar: a.id, acao: "Me candidatar" };
  if (a.repescagem) return { href: "/intern/extras", acao: "Pegar" };
  if (a.fonte === "LIBERADA" && lider) {
    const texto = `Oi! Tem vaga liberada ${a.tipo} na ${a.baseCode}, ${q}, e ainda me falta ${a.tipo} na meta. Pode me escalar nela?`;
    return { href: `/intern/mensagens?com=${lider.id}&texto=${encodeURIComponent(texto)}`, acao: "Pedir ao líder" };
  }
  if (a.fonte === "EXTRA") return { href: "/intern/extras", acao: "Pegar" };
  if (a.fonte === "GRADE") return { href: "/intern/trocas", acao: "Pedir" };
  if (a.fonte === "TROCA" && a.quemId) {
    const texto = `Oi! Vi sua oferta do ${a.baseCode} (${q}). Tenho interesse${a.ofereco ? ` — posso te dar o meu ${a.ofereco.baseCode} ${quando(a.ofereco.date, a.ofereco.period, a.ofereco.shift)}` : ""}. Topa?`;
    return { href: `/intern/mensagens?com=${a.quemId}&troca=${a.id}&texto=${encodeURIComponent(texto)}`, acao: "Conversar" };
  }
  return {};
}

const ROTULO_STATUS = { ELIGIBLE: "pode pegar", REQUIRES_APPROVAL: "precisa de aprovação" } as const;

function cartaoDaBusca(b: Busca, lider: { id: string; nome: string } | null, numero: (a: Avaliada, i: number) => number, casinhas?: LunaCasinhas): LunaCartao | undefined {
  const mostradas = b.opcoes.slice(0, MOSTRAR);
  if (!mostradas.length && !casinhas?.length) return undefined;
  const titulo = b.objetivo === "meta" ? "Para fechar sua meta" : b.objetivo === "troca" ? "Trocas que servem para você" : "Opções para você";
  return {
    tipo: "opcoes",
    titulo,
    itens: mostradas.map((a, i) => ({
      titulo: `${numero(a, i)}. ${a.baseCode} · ${quando(a.date, a.period, a.shift)}`,
      detalhe: `${a.tipo ?? "?"} · ${a.fonte === "TROCA" ? `troca com ${a.quem ?? "colega"}` : a.fonte === "LIBERADA" ? "vaga liberada" : a.fonte === "EXTRA" ? "extra" : "sobra da grade"} · ${ROTULO_STATUS[a.status as keyof typeof ROTULO_STATUS] ?? ""}`,
      mapa: a.baseCode,
      quando: { data: a.date, periodo: a.period, turno: a.shift },
      base: a.baseCode,
      tipoVaga: a.tipo,
      numero: numero(a, i),
      ...acaoDa(a, lider),
    })),
    verTudo: b.objetivo === "troca" ? { href: "/intern/trocas", rotulo: "Abrir Trocas" } : undefined,
    casinhas,
  };
}

/** Casinhas da meta com o que o plano cobriria, para a tela desenhar. */
function casinhasDa(b: Busca, meta: Meta | null): LunaCasinhas | undefined {
  if (b.objetivo !== "meta" || !meta || b.status === "INSUFFICIENT_DATA") return undefined;
  return GOAL_KINDS.filter((k) => meta.alvo[k] > 0).map((k) => {
    const marcadas = meta.alvo[k] - meta.faltam[k];
    return { tipo: k, alvo: meta.alvo[k], marcadas, cobre: Math.min(meta.faltam[k], b.plano.filter((a) => a.tipo === k).length) };
  });
}

// O jogo dos extras, como o código decide hoje (claim-extra-offer.ts, repescagem.ts, avisos.ts).
const GUIA_EXTRAS: LunaCartao = {
  tipo: "guia",
  titulo: "Como funciona o jogo dos extras",
  itens: [
    "**Extra comum**: o líder ou a coordenação publica e leva quem pegar primeiro na aba Extras. Não conta para a meta, e é **um extra por interno** — depois do primeiro, só vaga que conta na meta.",
    "**Repescagem**: vaga livre que ninguém ocupou vai a **sorteio** 8h antes do turno — o noturno às 11h do dia, o diurno às 20h da véspera. Inscreva-se antes em Extras → Sorteios; inscritos e resultado são públicos.",
    "A ordem do sorteio: primeiro quem tem casinha vazia no tipo (conta na meta), depois quem nunca teve extra, por último quem já teve (entra como extra). Empate, a ordem sorteada decide. O que sobrar fica para quem pegar primeiro.",
    "Em qualquer extra: 12h de descanso e nada no mesmo turno. Pegou, é seu — só o líder ou a coordenação tiram.",
    "Quem ainda precisa do tipo, ou marcou **Quero** naquele turno, recebe meu aviso aqui horas antes do sorteio — e o resultado depois.",
  ].map((titulo) => ({ titulo })),
};

// ---------------------------------------------------------------------------
// buscar_opcoes

/** "Para 29/10, 30/10 e 01/11" — o recorte que a busca usou, para o interno conferir. */
function diasPedidos(datas: { data: string; periodo?: string }[]): string {
  const ds = datas.map((d) => `${ddmm(d.data)}${lerPeriodo(d.periodo) === "NIGHT" ? " noite" : lerPeriodo(d.periodo) === "DAY" ? " dia" : ""}`);
  return `Só ${ds.length === 1 ? "no dia" : "nos dias"} ${ds.length === 1 ? ds[0] : `${ds.slice(0, -1).join(", ")} e ${ds.at(-1)}`}`;
}

const FONTES_PADRAO: Record<Pedido["objetivo"], Fonte[]> = {
  meta: ["LIBERADA", "GRADE", "EXTRA"],
  plantao: ["LIBERADA", "EXTRA", "GRADE"],
  troca: ["TROCA"],
};

export async function buscar(f: Fontes, ctx: LunaCtx, raw: Record<string, unknown>, memoria?: LunaMemoria): Promise<Resultado> {
  const args = sanearArgs(raw);
  const somente = (args.opcoes ?? [])
    .map((n) => memoria?.opcoes?.find((r) => r.n === n))
    .filter((r): r is LunaRef => Boolean(r));
  // "Dessas" sem lista numerada antes: não há o que reavaliar.
  if (args.opcoes?.length && !somente.length) {
    return { status: "INSUFFICIENT_DATA", registros: 0, texto: "A última resposta não trouxe uma lista numerada de vagas. Quer que eu procure de novo?" };
  }
  const objetivo = args.objetivo ?? (somente.length && somente.every((s) => s.fonte === "TROCA") ? "troca" : "plantao");
  let fontes = somente.length ? [...new Set(somente.map((s) => s.fonte))] : args.fontes ?? FONTES_PADRAO[objetivo];
  const prever = objetivo === "plantao" && !somente.length && (fontes.includes("LIBERADA") || fontes.includes("EXTRA"));

  const [meta, meus] = await Promise.all([f.meta(), f.meusPlantoes()]);
  const tiposDoPedido = args.tipos?.length ? args.tipos : GOAL_KINDS.filter((k) => (meta?.alvo[k] ?? 0) > 0);
  // "Tem vaga liberada pra mim?": responde pela situação dele (respostaDaLiberada),
  // não pela lista — eram centenas de vagas até dezembro, e o que ele precisa é
  // de duas ou três e de saber quem age.
  const soLiberada = Boolean(meta) && objetivo === "plantao" && !somente.length && !args.trocar_data && fontes.length === 1 && fontes[0] === "LIBERADA";
  const faltaNoPedido = meta ? tiposDoPedido.filter((k) => meta.faltam[k] > 0) : [];
  // Dia pedido além da janela padrão estica a janela até ele.
  const ultimaPedida = args.datas?.map((d) => d.data).sort().at(-1);
  const padrao = addDaysToDateStr(ctx.hoje, args.dias ?? (objetivo === "meta" ? 45 : 21));
  const limite = ultimaPedida && ultimaPedida > padrao ? ultimaPedida : padrao;
  const ate = (objetivo === "meta" || (soLiberada && faltaNoPedido.length)) && meta?.fim && meta.fim < limite ? meta.fim : limite;

  let largar: MeuPlantao | null = null;
  if (args.trocar_data) {
    const achados = acharMeu(meus, ctx.hoje, args.trocar_data, lerPeriodo(args.trocar_periodo));
    if (achados.length !== 1) {
      return {
        status: "INSUFFICIENT_DATA",
        registros: 0,
        texto: achados.length
          ? `Você tem mais de um plantão nesse dia (${achados.map((m) => quando(m.date, m.period, m.shift)).join(" e ")}). Qual deles quer trocar?`
          : `Não achei plantão seu marcado para ${args.trocar_data.slice(8, 10)}/${args.trocar_data.slice(5, 7)}. Seus próximos: ${ativos(meus).filter((m) => m.date >= ctx.hoje).slice(0, 4).map((m) => `${m.baseCode} ${quando(m.date, m.period, m.shift)}`).join("; ") || "nenhum"}.`,
      };
    }
    largar = achados[0];
  }

  // Vaga liberada é de quem precisa de reposição. Com a meta completa nos
  // tipos pedidos, nem vai buscar: diz quantos colegas estão na frente.
  // Vaga livre é de quem precisa de reposição. Nos tipos em que a meta já
  // fechou, só entra como candidatura — e só quando sobra vaga depois da fila.
  let fila = "";
  let candidatura: GoalKind[] = [];
  let soRepescagem = false;
  const completos = meta ? tiposDoPedido.filter((k) => meta.faltam[k] === 0) : [];
  if (objetivo !== "troca" && !somente.length && fontes.includes("LIBERADA") && completos.length) {
    const atual = await f.fila().catch(() => null);
    // Na pergunta só de liberada, candidatura não entra: a coordenação ainda não
    // decidiu nenhuma, e o caminho que anda para quem fechou a meta é o sorteio.
    candidatura = atual && !soLiberada ? completos.filter((k) => candidaturaAberta(atual[k])) : [];
    const fechados = completos.filter((k) => !candidatura.includes(k));
    // Só fica a que já caiu na repescagem: essa ele pega direto, meta fechada ou não.
    if (completos.length === tiposDoPedido.length && !candidatura.length) {
      fontes = fontes.filter((x) => x !== "LIBERADA");
      soRepescagem = true;
    }
    // Quem ainda precisa de algum tipo não recebe sermão de fila dos outros.
    if (fechados.length && completos.length === tiposDoPedido.length) {
      const quem = atual ? fechados.filter((k) => atual[k].precisam > 0).map((k, i) => `${atual[k].precisam}${i ? "" : ` ${atual[k].precisam === 1 ? "colega" : "colegas"}`} em ${k}`) : [];
      const naFila = quem.length > 1 ? `${quem.slice(0, -1).join(", ")} e ${quem.at(-1)}` : quem[0];
      fila = `Vaga liberada não aparece para você porque sua meta de ${fechados.join(" e ")} já está completa: ela vai primeiro para quem ainda precisa repor plantão${naFila ? ` (hoje esperam reposição ${naFila})` : ""}. Quando houver mais vaga livre do que gente nessa fila, você pode se candidatar.`;
    }
    if (candidatura.length) fila += `${fila ? "\n" : ""}Em ${candidatura.join(" e ")} há mais vaga livre do que colegas precisando repor: como sua meta desse tipo está completa, você pode se candidatar, e a coordenação decide quem fica.`;
  }

  const leituras: Record<Fonte, () => Promise<Oferta[]>> = {
    LIBERADA: () => f.liberadas(ate),
    EXTRA: () => f.extras(),
    GRADE: () => f.grade(),
    TROCA: () => f.trocas(),
  };
  const ofertas = (await Promise.all([
    ...fontes.map((x) => leituras[x]()),
    soRepescagem ? f.liberadas(ate).then((l) => l.filter((o) => o.repescagem)) : Promise.resolve([]),
  ])).flat();

  const pedido: Pedido = {
    objetivo,
    tipos: args.tipos,
    fontes,
    bloqueios: bloqueios(args),
    datas: args.datas?.map((d) => ({ data: d.data, ...(lerPeriodo(d.periodo) ? { periodo: lerPeriodo(d.periodo) } : {}) })),
    preferePeriodo: lerPeriodo(args.prefere_periodo),
    prefereDias: args.prefere_dias_semana?.map((d) => lerDiaSemana(d)!),
    ate,
    largar,
    somente,
    candidatura,
  };
  const busca = buscarOpcoes(ofertas, { meta, meus, pedido, hoje: ctx.hoje });

  // Troca: o lado do colega (descanso dele, cota de CRU, pedido pendente) só
  // o caso de uso sabe. Confere as primeiras antes de mostrar.
  if (objetivo === "troca") {
    const topo = busca.opcoes.slice(0, MOSTRAR + 1);
    const problemas = await Promise.all(topo.map((a) => (a.ofereco ? f.conferirTroca(a, a.ofereco) : null)));
    const barradas = problemas.filter(Boolean).length;
    if (barradas) busca.descartes.push({ motivo: "REGRA_DA_TROCA", n: barradas, exemplo: "" });
    busca.opcoes = [...topo.filter((_, i) => !problemas[i]), ...busca.opcoes.slice(topo.length)];
    busca.totalCompativeis = busca.opcoes.length;
    busca.precisamAprovacao = busca.opcoes.length;
    if (!busca.opcoes.length) busca.status = "NO_OPTIONS";
  }

  const mostradas = busca.opcoes.slice(0, MOSTRAR);
  const lider = mostradas.some((a) => a.fonte === "LIBERADA") ? await f.lider() : null;
  // Reavaliando opções da lista anterior: mesmo número e mesma memória, para
  // "a primeira" continuar sendo a primeira daquela lista.
  const original = new Map(somente.map((r) => [`${r.fonte}|${r.id}`, r.n]));
  const numero = (a: Avaliada, i: number) => original.get(`${a.fonte}|${a.id}`) ?? i + 1;
  let texto = textoDaBusca(busca, numero, ctx.voz);
  if (fila && busca.status !== "META_COMPLETA" && !mostradas.some((a) => a.repescagem)) texto += `\n${fila}`;
  if (args.datas?.length) texto = `${diasPedidos(args.datas)}:\n${texto}`;
  if (args.nao_posso?.length) texto += `\nLevei em conta que você não pode ${bloqueios(args).map(descreveBloqueio).join(", ")}.`;
  if (largar) texto = `Para largar seu **${largar.baseCode} ${quando(largar.date, largar.period, largar.shift)}**:\n${texto}`;
  if (mostradas.some((a) => a.fonte === "LIBERADA") && !lider) texto += "\nSua faculdade está sem líder ativo cadastrado: a vaga liberada depende dele.";

  // Sem rodízio ativo não há meta para dizer se conta ou vira extra: sem previsão.
  const previsao = prever && meta ? await preverRepescagem(f, ctx, meta, meus, pedido, busca) : null;
  if (previsao) texto += `\n\n${previsao.texto}`;

  const semRefs = { ...args };
  delete semRefs.opcoes;
  if (soLiberada && meta) {
    const pendentes = faltaNoPedido.length ? [] : (await f.solicitacoes().catch(() => [])).filter((s) => s.tipo === "FREE_SLOT");
    const r = respostaDaLiberada({ busca, meta, falta: faltaNoPedido, lider: await f.lider(), pendentes, previsao, hoje: ctx.hoje });
    const extra = [args.datas?.length ? diasPedidos(args.datas) + ":" : "", r.texto, args.nao_posso?.length ? `Levei em conta que você não pode ${bloqueios(args).map(descreveBloqueio).join(", ")}.` : ""];
    return {
      status: busca.status,
      registros: ofertas.length,
      texto: extra.filter(Boolean).join("\n"),
      cartao: r.cartao,
      // Falta meta: o que conta já está na lista, com a hora do sorteio de cada uma.
      previsao: faltaNoPedido.length ? undefined : previsao?.cartao,
      memoria: { busca: semRefs, opcoes: r.mostradas.map((a, i) => ({ n: i + 1, fonte: a.fonte, id: a.id })) },
    };
  }
  return {
    status: busca.status,
    registros: ofertas.length,
    texto,
    cartao: cartaoDaBusca(busca, lider, numero, casinhasDa(busca, meta)),
    previsao: previsao?.cartao,
    // Pergunta só de extra: explica o jogo junto, aberto quando não há nenhum.
    guia: !somente.length && fontes.length === 1 && fontes[0] === "EXTRA" ? { ...GUIA_EXTRAS, aberto: !mostradas.length } : undefined,
    memoria: somente.length
      ? memoria
      : { busca: semRefs, opcoes: mostradas.map((a, i) => ({ n: i + 1, fonte: a.fonte, id: a.id })) },
  };
}

// ---------------------------------------------------------------------------
// avaliar_troca

export async function avaliarTroca(f: Fontes, ctx: LunaCtx, raw: Record<string, unknown>, memoria?: LunaMemoria): Promise<Resultado> {
  const data = typeof raw.meu_plantao_data === "string" && DATA.test(raw.meu_plantao_data) ? raw.meu_plantao_data : null;
  const [meus, trocas] = await Promise.all([f.meusPlantoes(), f.trocas()]);
  if (!data) return { status: "INSUFFICIENT_DATA", registros: 0, texto: "Qual plantão seu você quer trocar (dia e turno)?" };
  const meusDoDia = acharMeu(meus, ctx.hoje, data, lerPeriodo(raw.meu_plantao_periodo)).filter((m) => !m.isExtraShift);
  if (meusDoDia.length !== 1) {
    return {
      status: "INSUFFICIENT_DATA",
      registros: 0,
      texto: meusDoDia.length ? "Você tem dois plantões nesse dia — diga se é o de dia ou o da noite." : `Não achei plantão seu (que não seja extra) em ${data.slice(8, 10)}/${data.slice(5, 7)}.`,
    };
  }
  const meu = meusDoDia[0];

  let alvos: Oferta[] = [];
  const n = Number(raw.opcao);
  if (Number.isInteger(n) && n > 0) {
    const ref = memoria?.opcoes?.find((r) => r.n === n);
    if (!ref) return { status: "INSUFFICIENT_DATA", registros: 0, texto: `Não sei qual é a opção ${n} — peça a lista de trocas de novo.` };
    if (ref.fonte !== "TROCA") return { status: "INCOMPATIBLE", registros: 0, texto: `A opção ${n} não é oferta de troca. Para largar um plantão, alguém precisa ficar com ele: veja as ofertas em Trocas ou publique o seu.` };
    alvos = trocas.filter((t) => t.id === ref.id);
    if (!alvos.length) return { status: "ALREADY_CLAIMED", registros: trocas.length, texto: "Essa oferta de troca não está mais aberta — alguém já fechou ou ela foi cancelada." };
  } else if (typeof raw.oferta_data === "string" && DATA.test(raw.oferta_data)) {
    const p = lerPeriodo(raw.oferta_periodo);
    alvos = trocas.filter((t) => t.date === raw.oferta_data && (!p || t.period === p));
  }
  if (alvos.length !== 1) {
    const doTipo = trocas.filter((t) => t.tipo === meu.tipo).slice(0, MOSTRAR);
    return {
      status: "INSUFFICIENT_DATA",
      registros: trocas.length,
      texto: alvos.length
        ? "Há mais de uma oferta nesse dia — diga a base ou o turno."
        : doTipo.length
          ? `Não achei essa oferta. Ofertas de ${meu.tipo} abertas:\n${doTipo.map((t, i) => `- ${i + 1}. ${t.baseCode} ${quando(t.date, t.period, t.shift)} · ${t.quem ?? "colega"}`).join("\n")}`
          : `Não há oferta de troca de ${meu.tipo} aberta agora. Você pode publicar o seu plantão em Trocas.`,
      memoria: doTipo.length && !alvos.length ? { opcoes: doTipo.map((t, i) => ({ n: i + 1, fonte: "TROCA", id: t.id })) } : undefined,
    };
  }

  const alvo = alvos[0];
  const meta = await f.meta();
  const avaliada = avaliarOferta(alvo, { meta, meus, hoje: ctx.hoje, pedido: { objetivo: "troca", ate: "9999-12-31", largar: meu } });
  const eu = `${meu.baseCode} ${quando(meu.date, meu.period, meu.shift)}`;
  const ele = `${alvo.baseCode} ${quando(alvo.date, alvo.period, alvo.shift)}`;
  if (avaliada.status === "INCOMPATIBLE") {
    return { status: "INCOMPATIBLE", registros: 1, texto: `Não dá para trocar seu **${eu}** pelo **${ele}**: ${avaliada.porque}.` };
  }
  const problema = await f.conferirTroca(alvo, meu);
  if (problema) return { status: "INCOMPATIBLE", registros: 1, texto: `Não dá para trocar seu **${eu}** pelo **${ele}**. ${problema}` };
  return {
    status: "REQUIRES_APPROVAL",
    registros: 1,
    texto: `Dá para propor: você entrega o **${eu}** e fica com o **${ele}** (${alvo.tipo}), de ${alvo.quem ?? "um colega"}. Descanso de 12h ok dos dois lados. Só vale quando ${alvo.quem?.split(" ")[0] ?? "o colega"} confirmar — proponha em Trocas.`,
    cartao: {
      tipo: "troca",
      titulo: "Troca possível",
      itens: [{ titulo: `${eu} → ${ele}`, detalhe: `${alvo.tipo} · com ${alvo.quem ?? "colega"}`, mapa: alvo.baseCode, ...acaoDa({ ...avaliada, ofereco: meu }, null) }],
      verTudo: { href: "/intern/trocas", rotulo: "Propor em Trocas" },
    },
    memoria: { opcoes: [{ n: 1, fonte: "TROCA", id: alvo.id }] },
  };
}

// ---------------------------------------------------------------------------
// explicar_plantao

export async function explicar(f: Fontes, ctx: LunaCtx, raw: Record<string, unknown>): Promise<Resultado> {
  const [meta, meus] = await Promise.all([f.meta(), f.meusPlantoes()]);
  const data = typeof raw.data === "string" && DATA.test(raw.data) ? raw.data : null;
  const periodo = lerPeriodo(raw.periodo);
  if (data) {
    const doDia = meus.filter((m) => m.date === data && (!periodo || m.period === periodo));
    if (!doDia.length) return { status: "NO_OPTIONS", registros: 0, texto: `Não achei plantão seu em ${data.slice(8, 10)}/${data.slice(5, 7)} (olho os últimos 75 dias e o futuro). Se ele sumiu da escala, fale com o líder.` };
    return { status: "OK", registros: doDia.length, texto: doDia.map((m) => `- ${explicarPlantao(m, meta, ctx.hoje)}`).join("\n") };
  }
  // Sem data: os do rodízio que não estão contando.
  const inicio = meta?.inicio ?? addDaysToDateStr(ctx.hoje, -75);
  const naoContam = meus
    .filter((m) => m.date >= inicio && m.date <= ctx.hoje && m.status !== "CANCELLED")
    .map((m) => ({ m, t: explicarPlantao(m, meta, ctx.hoje) }))
    .filter(({ t }) => !/: (contou|está em andamento|agendado)/.test(t));
  if (!naoContam.length) return { status: "OK", registros: 0, texto: "Todos os seus plantões do rodízio estão contando (realizados ou agendados). Se algum não aparece, diga a data." };
  return { status: "OK", registros: naoContam.length, texto: ["Estes não estão contando para a meta:", ...naoContam.slice(0, 6).map(({ t }) => `- ${t}`)].join("\n") };
}

// ---------------------------------------------------------------------------
// Definições para o modelo. Descrições curtas: o modelo só precisa saber
// QUANDO chamar e COMO traduzir o pedido.

const DIA_ENUM = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

export const FERRAMENTAS: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (f: Fontes, ctx: LunaCtx, args: Record<string, unknown>, memoria?: LunaMemoria) => Promise<Resultado>;
}[] = [
  {
    name: "buscar_opcoes",
    description: "Busca vagas, extras, sobras da grade e trocas JÁ cruzadas com a meta, o descanso de 12h e a agenda do interno, classificadas e ordenadas. Use para qualquer pedido de opção/vaga/troca/'consigo fechar a meta'.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        objetivo: { type: "string", enum: ["meta", "plantao", "troca"], description: "meta: só o que fecha a meta; plantao: qualquer plantão a mais; troca: largar um plantão dele" },
        tipos: { type: "array", items: { type: "string", enum: ["USA", "CRU", "CRL"] } },
        fontes: { type: "array", items: { type: "string", enum: ["liberada", "extra", "grade", "troca"] }, description: "Só se o interno pediu uma fonte específica" },
        nao_posso: {
          type: "array",
          description: "Só dias/turnos que ele disse que não pode (prova, compromisso). Plantão que ele já tem não entra aqui. Sem periodo = o dia inteiro.",
          items: { type: "object", additionalProperties: false, properties: { dia_semana: { type: "string", enum: DIA_ENUM }, data: { type: "string", description: "YYYY-MM-DD" }, periodo: { type: "string", enum: ["dia", "noite"] } } },
        },
        datas: {
          type: "array",
          description: "Só estes dias: os que ele disse que pode ou quer pegar ('dia 09/11 tem?', 'preciso pegar 29, 30 e 01'). Não confundir com nao_posso.",
          items: { type: "object", additionalProperties: false, required: ["data"], properties: { data: { type: "string", description: "YYYY-MM-DD" }, periodo: { type: "string", enum: ["dia", "noite"] } } },
        },
        prefere_periodo: { type: "string", enum: ["dia", "noite"] },
        prefere_dias_semana: { type: "array", items: { type: "string", enum: DIA_ENUM }, description: "Fim de semana = sex, sab, dom" },
        dias: { type: "integer", description: "Janela em dias a partir de hoje (padrão 21; meta: até o fim do rodízio)" },
        trocar_data: { type: "string", description: "YYYY-MM-DD do plantão DELE que quer largar (objetivo troca)" },
        trocar_periodo: { type: "string", enum: ["dia", "noite"] },
        opcoes: { type: "array", items: { type: "integer" }, description: "Números da ÚLTIMA LISTA para reavaliar ('a segunda' = [2]); só se houver lista" },
      },
    },
    run: (f, ctx, args, memoria) => buscar(f, ctx, args, memoria),
  },
  {
    name: "avaliar_troca",
    description: "Confere se um plantão dele pode ser trocado por uma oferta de troca específica (tipo, descanso dos dois lados, cota de CRU, faculdade).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["meu_plantao_data"],
      properties: {
        meu_plantao_data: { type: "string", description: "YYYY-MM-DD" },
        meu_plantao_periodo: { type: "string", enum: ["dia", "noite"] },
        opcao: { type: "integer", description: "Número da oferta na última lista" },
        oferta_data: { type: "string", description: "YYYY-MM-DD, se ele disse a data em vez do número" },
        oferta_periodo: { type: "string", enum: ["dia", "noite"] },
      },
    },
    run: (f, ctx, args, memoria) => avaliarTroca(f, ctx, args, memoria),
  },
  {
    name: "explicar_plantao",
    description: "Explica por que um plantão dele conta ou não conta para a meta (extra, falta, checkout pendente, fora do rodízio, cancelado). Sem data: lista os que não estão contando.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { data: { type: "string", description: "YYYY-MM-DD" }, periodo: { type: "string", enum: ["dia", "noite"] } },
    },
    run: (f, ctx, args) => explicar(f, ctx, args),
  },
  {
    name: "situacao_da_base",
    description: "Se a base vai ativar: no turno de agora, o médico que chegou, o de saída ou se está desativada; em turno futuro, o médico previsto na escala. Sem base: a do plantão dele.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        base: { type: "string", description: "Código (CB02) ou nome (Cabula) da base, se ele disse" },
        data: { type: "string", description: "YYYY-MM-DD, se ele falou de outro dia" },
        periodo: { type: "string", enum: ["dia", "noite"] },
      },
    },
    run: (f, ctx, args) => {
      // Vira texto e passa pelo mesmo leitor da pergunta direta.
      const data = typeof args.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.data) ? `${args.data.slice(8, 10)}/${args.data.slice(5, 7)}` : "";
      const periodo = args.periodo === "noite" ? "noite" : args.periodo === "dia" ? "de dia" : "";
      const base = typeof args.base === "string" ? args.base : "";
      return situacaoDaBase(f, ctx, [base, data, periodo].join(" "), new Date(), base);
    },
  },
];

const semAcentoMaiusculo = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

/** "Estou na base tal, vai ativar?" — a base citada (código ou nome) ou a do plantão dele. */
// ---------------------------------------------------------------------------
// Repescagem prevista. Vaga livre aberta agora que ainda não é dele (meta do
// tipo fechada, fila de reposição, líder) e que, se ninguém for escalado,
// vira extra numa hora sabida (repescagem.ts). Dizer a hora poupa o interno
// de ficar olhando o site — e o modelo de responder "nada agora".

const TURNOS_PREVISTOS = 3;

function diaRelativo(data: string, hoje: string) {
  if (data === hoje) return "hoje";
  if (data === addDaysToDateStr(hoje, 1)) return "amanhã";
  return quando(data, "DAY").replace(/ dia$/, "");
}

export async function preverRepescagem(f: Fontes, ctx: LunaCtx, meta: Meta | null, meus: MeuPlantao[], pedido: Pedido, busca: Busca): Promise<{ texto: string; cartao: LunaCartao } | null> {
  // Já pode agora (direto ou pelo líder): não é previsão. Candidatura é — a coordenação pode não decidir a tempo.
  const jaPode = new Set(busca.opcoes.filter((a) => !a.candidatura).map((a) => a.id));
  const livres = (await f.liberadas(pedido.ate)).filter((o) => !o.repescagem && !jaPode.has(o.id));
  // Avaliada como se já estivesse no sorteio: descanso, agenda, dias e tipos
  // pedidos. Quem já teve extra também concorre — só fica por último.
  const cx = { meta: meta && { ...meta, jaTemExtra: false }, meus, pedido: { ...pedido, candidatura: [] }, hoje: ctx.hoje };
  const servem = livres.map((o) => avaliarOferta({ ...o, repescagem: true }, cx)).filter((a) => a.status === "ELIGIBLE");
  if (!servem.length) return null;

  const turnos = new Map<string, { date: string; period: Periodo; shift: string | null; tipos: Set<string>; n: number; conta: boolean }>();
  for (const a of servem) {
    const k = `${a.date}|${a.period}|${a.shift ?? ""}`;
    const t = turnos.get(k) ?? { date: a.date, period: a.period, shift: a.shift, tipos: new Set<string>(), n: 0, conta: false };
    t.n += 1;
    if (a.tipo) t.tipos.add(a.tipo);
    t.conta ||= a.contaParaMeta;
    turnos.set(k, t);
  }
  const lista = [...turnos.values()]
    .map((t) => ({ ...t, abre: aberturaDaRepescagem(t.date, t.period, t.shift) }))
    .sort((x, y) => `${x.abre.date}${String(x.abre.hour).padStart(2, "0")}`.localeCompare(`${y.abre.date}${String(y.abre.hour).padStart(2, "0")}`))
    .slice(0, pedido.datas?.length ? 6 : TURNOS_PREVISTOS);

  const sorteioEm = (t: (typeof lista)[number]) => `${diaRelativo(t.abre.date, ctx.hoje)} às ${t.abre.hour}h`;
  const vagas = (n: number) => `${n} ${n === 1 ? "vaga" : "vagas"}`;
  // Ordem do sorteio (sorteio-repescagem.ts): casinha vazia, nunca teve extra, já teve.
  const lugar = (conta: boolean) => (conta ? "conta na sua meta, você entra na frente" : meta?.jaTemExtra ? "entra como extra, você fica por último (já teve extra)" : "entra como extra, você vem depois de quem precisa da meta");
  const linhas = [
    "**Pode ir a sorteio na repescagem** — vaga livre que ninguém for escalado até a hora é sorteada entre os inscritos:",
    ...lista.map((t) => `- **${quando(t.date, t.period, t.shift)}**: ${vagas(t.n)} (${[...t.tipos].join(", ")}) — sorteio **${sorteioEm(t)}**; ${lugar(t.conta)}`),
    "Para concorrer, inscreva-se em **Extras → Sorteios** até a hora. Inscritos e resultado são públicos, e eu te conto aqui como foi — não precisa ficar olhando o site.",
  ];
  return {
    texto: linhas.join("\n"),
    cartao: {
      tipo: "previsao",
      titulo: "Sorteios da repescagem",
      itens: lista.map((t) => ({
        titulo: `${quando(t.date, t.period, t.shift)} · sorteio ${sorteioEm(t)}`,
        quando: { data: t.date, periodo: t.period, turno: t.shift },
        base: `sorteio ${sorteioEm(t)}`,
        tipoVaga: [...t.tipos].join(", ") || null,
        detalhe: `${vagas(t.n)} livre${t.n === 1 ? "" : "s"} · ${t.conta ? "conta na sua meta" : "entra como extra"}`,
        href: "/intern/extras",
        acao: "Me inscrever",
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// "Tem vaga liberada pra mim?" pela situação: quem ele é agora, o caminho que
// anda para ele (com no máximo 3 vagas e um botão) e quando voltar a olhar.
// Medido em 30/10: 491 vagas livres abertas, só 16 nas 48h seguintes; a
// lista inteira não ajudava ninguém.

const NA_LIBERADA = 3;

/** Próxima abertura da repescagem: 11h (noturno do dia) e 20h (diurno do dia seguinte). */
export function proximaAbertura(agora: Date = new Date()) {
  const h = getBrazilNowParts(agora).hour;
  return h < 11 ? "hoje às 11h" : h < 20 ? "hoje às 20h" : "amanhã às 11h";
}

export function respostaDaLiberada(p: {
  busca: Busca;
  meta: Meta;
  falta: GoalKind[];
  lider: { id: string; nome: string } | null;
  pendentes: Solicitacao[];
  previsao: { texto: string } | null;
  hoje: string;
  agora?: Date;
}): { texto: string; cartao?: LunaCartao; mostradas: Avaliada[] } {
  const { busca, meta, falta, lider, hoje } = p;
  const numero = (_a: Avaliada, i: number) => i + 1;

  if (falta.length) {
    const faltaTxt = falta.map((k) => `${meta.faltam[k]} ${k}`).join(" e ");
    const fecha = meta.fim ? ` e seu rodízio fecha **${diaRelativo(meta.fim, hoje)}**` : "";
    const linhas = [`Falta **${faltaTxt}** na sua meta${fecha}.`];
    const contam = busca.opcoes.filter((a) => a.contaParaMeta && !a.candidatura);
    const mostradas = contam.slice(0, NA_LIBERADA);
    if (!mostradas.length) {
      linhas.push(`Nenhuma vaga liberada que conte na sua meta cabe no seu descanso${meta.fim ? ` até ${ddmm(meta.fim)}` : ""}.`);
      linhas.push('Pergunte "que vagas fecham minha meta?": aí eu olho também sobra da grade e extras.');
      return { texto: linhas.join("\n"), mostradas };
    }
    linhas.push(mostradas.length === 1 ? "Esta conta e cabe no seu descanso:" : "Estas contam e cabem no seu descanso:");
    linhas.push(...mostradas.map((a, i) => `- ${linhaDaOpcao(a, i + 1)}`));
    if (contam.length > mostradas.length) linhas.push(`(+${contam.length - mostradas.length} que também contam)`);

    const peloLider = mostradas.filter((a) => !a.repescagem);
    if (peloLider.length) {
      linhas.push(lider
        ? `Quem coloca você nelas é ${lider.nome}, seu líder. Toque em **Pedir ao líder**: a mensagem já vai pronta com ${peloLider.length === 1 ? "a vaga" : "essas vagas"}.`
        : "Quem coloca você nelas é o líder da sua faculdade, e ela está sem líder ativo cadastrado: fale com a coordenação.");
      // CRU nunca vai a sorteio (sorteio-repescagem.ts): só troca.
      const turnos = new Map<string, string>();
      for (const a of peloLider.filter((x) => x.tipo !== "CRU")) {
        const abre = aberturaDaRepescagem(a.date, a.period, a.shift);
        turnos.set(`${a.date}|${a.period}|${a.shift ?? ""}`, `${quando(a.date, a.period, a.shift)} (sorteio ${diaRelativo(abre.date, hoje)} às ${abre.hour}h)`);
      }
      const sorteios = [...turnos.values()];
      if (sorteios.length) {
        linhas.push(`Se ninguém escalar, vão a sorteio: ${sorteios.length > 1 ? `${sorteios.slice(0, -1).join(", ")} e ${sorteios.at(-1)}` : sorteios[0]}. Você entra na frente, por precisar da meta — inscreva-se em **Extras → Sorteios**.`);
      }
    }
    const cartao = cartaoDaBusca({ ...busca, objetivo: "meta", opcoes: mostradas }, lider, numero);
    if (cartao && lider && peloLider.length) {
      const lista = peloLider.map((a) => `${a.baseCode} ${quando(a.date, a.period, a.shift)}`).join("; ");
      const texto = `Oi! Ainda me falta ${faltaTxt} na meta. Tem vaga liberada que conta: ${lista}. Pode me escalar em uma delas?`;
      cartao.verTudo = { href: `/intern/mensagens?com=${lider.id}&texto=${encodeURIComponent(texto)}`, rotulo: "Pedir ao líder" };
    }
    return { texto: linhas.join("\n"), cartao, mostradas };
  }

  // Meta fechada: vaga liberada, para ele, só na repescagem — já aberta (pega
  // quem chegar) ou no sorteio. Quem já teve extra concorre, mas por último.
  const linhas = [meta.jaTemExtra
    ? "Sua meta está fechada e você já teve seu extra: no sorteio da repescagem você fica por último, depois de quem precisa da meta e de quem nunca teve extra."
    : "Sua meta está fechada e você **ainda não teve extra**: tem direito a um, e o caminho é o sorteio da repescagem."];
  const mostradas = busca.opcoes.filter((a) => a.repescagem).slice(0, NA_LIBERADA);
  if (mostradas.length) {
    linhas.push(`Já abertas agora, pega quem chegar primeiro em **Extras**:`);
    linhas.push(...mostradas.map((a, i) => `- ${linhaDaOpcao(a, i + 1)}`));
  }
  linhas.push(p.previsao ? p.previsao.texto : "Nos próximos dias não há vaga livre que caiba no seu descanso indo a sorteio.");
  if (p.pendentes.length) {
    linhas.push(p.pendentes.length === 1
      ? "Sua candidatura está com a coordenação: não precisa pedir de novo."
      : `Suas ${p.pendentes.length} candidaturas estão com a coordenação: não precisa pedir de novo.`);
  }
  linhas.push(`Vaga liberada só abre para você na repescagem: 11h (turno da noite) e 20h (turno do dia seguinte). Próxima: **${proximaAbertura(p.agora)}** — entre uma e outra, nada novo aparece.`);
  const cartao = mostradas.length ? cartaoDaBusca({ ...busca, opcoes: mostradas }, null, numero) : undefined;
  return { texto: linhas.join("\n"), cartao, mostradas };
}

// ---------------------------------------------------------------------------
// Solicitações pendentes: lista e avisa o líder. Sem modelo — é só cruzar.

export async function solicitacoesPendentes(f: Fontes, ctx: LunaCtx): Promise<Resultado> {
  const pend = await f.solicitacoes();
  if (!pend.length) {
    return { status: "NO_OPTIONS", registros: 0, texto: "Você não tem solicitação esperando decisão agora. As que já foram decididas (e as de dias que já passaram) ficam na aba **Trocas**." };
  }
  const doLider = pend.filter((s) => s.decide === "LIDER");
  const daCoordenacao = pend.length - doLider.length;
  const linhas = [
    pend.length === 1 ? "Você tem 1 solicitação esperando decisão:" : `Você tem ${pend.length} solicitações esperando decisão:`,
    ...pend.map((s) => `- ${linhaDaSolicitacao(s, ctx.hoje)} · decide ${s.decide === "LIDER" ? "o líder" : "a coordenação"}`),
  ];
  if (daCoordenacao) linhas.push(`${daCoordenacao === 1 ? "A que a coordenação decide segue" : "As que a coordenação decide seguem"} na fila dela: essa eu não consigo cobrar daqui.`);
  const pronto = (aviso?: AvisoAoLider): Resultado => ({ status: "OK", registros: pend.length, texto: linhas.join("\n"), aviso });
  if (!doLider.length) return pronto();

  const [lider, ultimo] = await Promise.all([f.lider(), f.avisoAoLider()]);
  if (!lider) {
    linhas.push("Sua faculdade está sem líder ativo cadastrado, então não tenho a quem avisar. Fale com a coordenação.");
    return pronto();
  }
  if (ultimo && doLider.every((s) => ultimo.ids.includes(s.id))) {
    linhas.push(`Já avisei ${lider.nome}, seu líder, hoje às ${ultimo.hora}. Se até amanhã ninguém decidir, pergunte de novo que eu lembro.`);
    return pronto();
  }
  return pronto({
    para: lider.id,
    ids: doLider.map((s) => s.id),
    itens: doLider.map((s) => linhaDaSolicitacao(s, ctx.hoje)),
    feito: `Avisei ${lider.nome}, seu líder, agora por mensagem aqui no app, com essa lista.`,
    falhou: `Tentei avisar ${lider.nome}, seu líder, mas a mensagem não saiu agora. Pergunte de novo daqui a pouco.`,
  });
}

export async function situacaoDaBase(f: Fontes, ctx: LunaCtx, texto: string, now: Date = new Date(), baseDita = ""): Promise<Resultado> {
  const [lista, meus] = await Promise.all([f.bases(), f.meusPlantoes()]);
  const t = semAcentoMaiusculo(texto);
  const codigo = t.match(/\b([A-Z]{2})\s?(\d{2})\b/);
  // "Base Pau Miúdo (2)" é a segunda viatura do mesmo endereço: o nome é o mesmo.
  const nomeDe = (b: { name: string }) => semAcentoMaiusculo(b.name).replace(/^BASE\s+/, "").replace(/\s*\(\d\)\s*$/, "").trim();
  const porNome = lista.filter((b) => nomeDe(b).length >= 4 && t.includes(nomeDe(b)));
  const exibido = (b: { name: string }) => b.name.replace(/^Base\s+/i, "").replace(/\s*\(\d\)\s*$/, "").trim();
  let citada = (codigo && lista.find((b) => b.code === `${codigo[1]}${codigo[2]}`)?.code) || null;
  if (!citada && porNome.length === 1) citada = porNome[0].code;
  if (!citada && porNome.length > 1) {
    // Duas viaturas no mesmo endereço: vale a do plantão dele, se for uma delas.
    const dele = ativos(meus).filter((m) => m.date >= ctx.hoje).find((m) => porNome.some((b) => b.code === m.baseCode));
    if (dele) citada = dele.baseCode;
    else {
      return { status: "INSUFFICIENT_DATA", registros: 0, texto: `A ${exibido(porNome[0])} tem ${porNome.length} viaturas: ${porNome.map((b) => b.code).join(" e ")}. Qual delas?` };
    }
  }
  if (!citada && baseDita.trim()) {
    const usa = lista.filter((b) => /^[A-Z]{2}\d{2}$/.test(b.code));
    return { status: "INSUFFICIENT_DATA", registros: 0, texto: `Não conheço a base "${baseDita.trim()}". As bases são: ${usa.map((b) => `${b.code} (${exibido(b)})`).join(", ")}.` };
  }
  const { baseCode, turno } = baseETurno(meus, now, citada, turnoPedido(texto, now));
  if (!baseCode) {
    return { status: "INSUFFICIENT_DATA", registros: 0, texto: "Não achei plantão seu agora. Diga a base (ex.: \"estou na CB02, vai ativar?\")." };
  }
  const [situacao, escala] = await Promise.all([f.situacaoDoTurno(baseCode, inicioDoTurno(turno)), f.medicosPrevistos(turno.date, turno.period)]);
  const previstos = { consultado: escala.consultado, diaSemEscala: escala.diaSemEscala, nomes: escala.porBase[baseCode] ?? [] };
  return {
    status: now < inicioDoTurno(turno)
      ? (!previstos.consultado || previstos.diaSemEscala ? "SEM_ESCALA" : previstos.nomes.length ? "PREVISTO" : "FURO_NA_ESCALA")
      : !situacao.consultado ? "FAILED" : situacao.desativada ? "DESATIVADA" : situacao.chegaram.length ? "MEDICO_CHEGOU" : situacao.saindo.length ? "MEDICO_SAINDO" : "SEM_MEDICO",
    registros: situacao.chegaram.length + situacao.saindo.length,
    texto: textoDaBaseAgora({ baseCode, turno, now, situacao, previstos }),
  };
}
