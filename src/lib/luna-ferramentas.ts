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
  FONTES, MOSTRAR, ativos, avaliarOferta, buscarOpcoes, explicarPlantao, quando, textoDaBusca,
  type Avaliada, type Bloqueio, type Busca, type Fonte, type Meta, type MeuPlantao, type Oferta, type Pedido, type Periodo,
} from "@/lib/luna-inteligencia";
import { addDaysToDateStr } from "@/lib/utils";
import { baseETurno, inicioDoTurno, textoDaBaseAgora, turnoPedido } from "@/lib/luna-base-agora";
import { candidaturaAberta } from "@/features/extra-offers/application/fila-de-reposicao";

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
  tipo: "opcoes" | "troca" | "plantoes" | "guia";
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

export type Resultado = {
  texto: string;
  cartao?: LunaCartao;
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
    "**Extra comum**: o líder ou a coordenação publica e leva quem pegar primeiro na aba Extras. Não conta para a meta.",
    "**Repescagem**: vaga livre que ninguém ocupou vira extra 8h antes do turno — o noturno abre às 11h do dia, o diurno às 20h da véspera — e fecha quando o turno começa.",
    "Na repescagem você pega direto, sem líder. Falta esse tipo na sua meta? Conta como plantão normal. Meta já fechada? Vira extra, e esse é **um só por interno**.",
    "Em qualquer extra: 12h de descanso e nada no mesmo turno. Pegou, é seu — só o líder ou a coordenação tiram.",
    "Quem ainda precisa do tipo, ou marcou **Quero** naquele turno e ainda não teve extra, recebe meu aviso aqui quando a repescagem abre.",
  ].map((titulo) => ({ titulo })),
};

// ---------------------------------------------------------------------------
// buscar_opcoes

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

  const [meta, meus] = await Promise.all([f.meta(), f.meusPlantoes()]);
  const limite = addDaysToDateStr(ctx.hoje, args.dias ?? (objetivo === "meta" ? 45 : 21));
  const ate = objetivo === "meta" && meta?.fim && meta.fim < limite ? meta.fim : limite;

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
  const tiposDoPedido = args.tipos?.length ? args.tipos : GOAL_KINDS.filter((k) => (meta?.alvo[k] ?? 0) > 0);
  const completos = meta ? tiposDoPedido.filter((k) => meta.faltam[k] === 0) : [];
  if (objetivo !== "troca" && !somente.length && fontes.includes("LIBERADA") && completos.length) {
    const atual = await f.fila().catch(() => null);
    candidatura = atual ? completos.filter((k) => candidaturaAberta(atual[k])) : [];
    const fechados = completos.filter((k) => !candidatura.includes(k));
    if (completos.length === tiposDoPedido.length && !candidatura.length) fontes = fontes.filter((x) => x !== "LIBERADA");
    // Quem ainda precisa de algum tipo não recebe sermão de fila dos outros.
    if (fechados.length && completos.length === tiposDoPedido.length) {
      const quem = atual ? fechados.filter((k) => atual[k].precisam > 0).map((k) => `${atual[k].precisam} em ${k}`) : [];
      fila = `Vaga liberada vai primeiro para quem precisa de reposição${quem.length ? ` (hoje: ${quem.join(", ")})` : ""}. Candidatura abre quando sobrar vaga.`;
    }
    if (candidatura.length) fila += `${fila ? "\n" : ""}Sobra vaga livre de ${candidatura.join(" e ")}: como sua meta está completa, você se candidata e a coordenação decide.`;
  }

  const leituras: Record<Fonte, () => Promise<Oferta[]>> = {
    LIBERADA: () => f.liberadas(ate),
    EXTRA: () => f.extras(),
    GRADE: () => f.grade(),
    TROCA: () => f.trocas(),
  };
  const ofertas = (await Promise.all(fontes.map((x) => leituras[x]()))).flat();

  const pedido: Pedido = {
    objetivo,
    tipos: args.tipos,
    fontes,
    bloqueios: bloqueios(args),
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
  if (fila && busca.status !== "META_COMPLETA") texto += `\n${fila}`;
  if (largar) texto = `Para largar seu **${largar.baseCode} ${quando(largar.date, largar.period, largar.shift)}**:\n${texto}`;
  if (mostradas.some((a) => a.fonte === "LIBERADA") && !lider) texto += "\nSua faculdade está sem líder ativo cadastrado: a vaga liberada depende dele.";

  const semRefs = { ...args };
  delete semRefs.opcoes;
  return {
    status: busca.status,
    registros: ofertas.length,
    texto,
    cartao: cartaoDaBusca(busca, lider, numero, casinhasDa(busca, meta)),
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
