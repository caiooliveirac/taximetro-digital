/**
 * Mercado de trocas — casa ofertas abertas com quem pode e quer pegá-las.
 *
 * Elegibilidade decide, sinais explicam, pontuação ordena. A elegibilidade é a
 * mesma que o servidor cobra na proposta e na confirmação
 * (handle-swap-peer-action.ts): plantão do mesmo tipo de base, outra faculdade
 * só em USA, descanso de 12h para os dois lados, cota de uma troca de CRU por
 * rodízio, plantão que não está em outra solicitação. Sugestão que o servidor
 * recusaria depois é pior que sugestão nenhuma.
 *
 * Os sinais (day-signal-policy.ts) entram assim: outro serviço conta como
 * plantão na regra das 12h; Quero/Posso no turno da oferta põem a oferta no
 * topo; Quero/Posso de quem oferta num turno em que eu tenho plantão diz qual
 * plantão meu ele aceita em troca.
 */
import { hasShiftStarted } from "@/lib/utils";
import { plantaoSemDescanso, turnosColados, type TurnoDePlantao } from "./rest-policy";
import type { SinalMarcado } from "./day-signal-policy";

export type PlantaoDoMercado = {
  id: string;
  internId: string;
  facultyId: string;
  date: string;
  period: "DAY" | "NIGHT";
  shift: string | null;
  baseCode: string;
  baseName: string;
  baseType: string;
  status: string;
  isExtraShift: boolean;
};

export type SinalDoMercado = SinalMarcado & { internId: string };

export type OfertaAberta = {
  requestId: string;
  plantao: PlantaoDoMercado;
  nome: string;
  facultyAbbr: string | null;
  criadaEm: string;
};

export type ContextoDoMercado = {
  agora: Date;
  plantoes: PlantaoDoMercado[];
  sinais: SinalDoMercado[];
  /** Plantões já envolvidos em solicitação aberta ou pendente: não entram como moeda de troca. */
  bloqueados: Set<string>;
  /** Internos que já gastaram a troca de CRU do rodízio. */
  cotaCruUsada: Set<string>;
  nomes: Map<string, string>;
  /** Bases favoritas (1) e a evitar (-1) de cada interno, pelo código da base. */
  preferencias?: Map<string, Map<string, number>>;
};

export type Caixa = "PERFEITA" | "COMBINA" | "PODE" | "SO_ENTREGANDO" | "FORA";

export type Avaliacao = {
  caixa: Caixa;
  motivo: string;
  /** Plantão de quem avalia que vai em troca. Null só quando FORA. */
  entregar: PlantaoDoMercado | null;
  /** Para ordenar dentro da caixa: maior primeiro. */
  forca: number;
};

const TIPO: Record<string, string> = { USA: "Ambulância", CENTRAL: "Regulação", CRL: "Leitos" };
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const chave = (date: string, period: "DAY" | "NIGHT") => `${date.slice(0, 10)}|${period}`;

function nomeCurto(p: PlantaoDoMercado) {
  return p.baseName.replace(/^Base\s+/i, "");
}

/** "Periperi, qua 11/11 noite" */
export function descrevePlantao(p: { baseName: string; date: string; period: "DAY" | "NIGHT" }): string {
  const d = p.date.slice(0, 10);
  const [, mes, dia] = d.split("-");
  const dow = DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()];
  return `${p.baseName.replace(/^Base\s+/i, "")}, ${dow} ${dia}/${mes} ${p.period === "DAY" ? "dia" : "noite"}`;
}

function primeiroNome(nome: string) {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

export function plantaoTrocavel(p: PlantaoDoMercado, agora: Date): boolean {
  return (
    (p.status === "SCHEDULED" || p.status === "CONFIRMED") &&
    !p.isExtraShift &&
    !hasShiftStarted(p.date.slice(0, 10), p.period, p.shift, agora)
  );
}

// Índices por interno: o resumo da oferta avalia cada colega contra ela, e
// varrer a janela inteira a cada avaliação ficaria quadrático.
const indicePlantoes = new WeakMap<PlantaoDoMercado[], Map<string, PlantaoDoMercado[]>>();
const indiceSinais = new WeakMap<SinalDoMercado[], Map<string, SinalDoMercado[]>>();

function agrupar<T extends { internId: string }>(lista: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of lista) m.set(x.internId, [...(m.get(x.internId) ?? []), x]);
  return m;
}

function plantoesDe(ctx: ContextoDoMercado, internId: string): PlantaoDoMercado[] {
  let m = indicePlantoes.get(ctx.plantoes);
  if (!m) indicePlantoes.set(ctx.plantoes, (m = agrupar(ctx.plantoes)));
  return m.get(internId) ?? [];
}

function sinaisDe(ctx: ContextoDoMercado, internId: string): SinalDoMercado[] {
  let m = indiceSinais.get(ctx.sinais);
  if (!m) indiceSinais.set(ctx.sinais, (m = agrupar(ctx.sinais)));
  return m.get(internId) ?? [];
}

function sinalDe(ctx: ContextoDoMercado, internId: string, k: string) {
  return sinaisDe(ctx, internId).find((s) => chave(s.date, s.period) === k);
}

/** Outro serviço entra na regra das 12h como se fosse plantão. */
function turnosOcupados(ctx: ContextoDoMercado, internId: string, sem: Set<string>): TurnoDePlantao[] {
  const plantoes = plantoesDe(ctx, internId)
    .filter((p) => !sem.has(p.id))
    .map((p) => ({ date: p.date.slice(0, 10), period: p.period, shift: p.shift, baseCode: nomeCurto(p) }));
  const outros = sinaisDe(ctx, internId)
    .filter((s) => s.signal === "OUTRO_SERVICO")
    .map((s) => ({ date: s.date.slice(0, 10), period: s.period, shift: null, baseCode: s.label || "outro serviço" }));
  return [...plantoes, ...outros];
}

function cabe(ctx: ContextoDoMercado, internId: string, recebe: PlantaoDoMercado, entrega: PlantaoDoMercado): boolean {
  const novo = { date: recebe.date.slice(0, 10), period: recebe.period, shift: recebe.shift, baseCode: recebe.baseCode };
  return !plantaoSemDescanso(novo, turnosOcupados(ctx, internId, new Set([entrega.id, recebe.id])));
}

/** O plantão do interno que colide com um outro serviço dele, se houver. */
function colideComOutroServico(ctx: ContextoDoMercado, p: PlantaoDoMercado): boolean {
  const outros = new Set(
    sinaisDe(ctx, p.internId)
      .filter((s) => s.signal === "OUTRO_SERVICO")
      .map((s) => chave(s.date, s.period)),
  );
  const k = chave(p.date, p.period);
  if (outros.has(k)) return true;
  return !p.shift && turnosColados({ date: p.date.slice(0, 10), period: p.period }).some((c) => outros.has(c));
}

/**
 * O que a oferta é para `internId`: em que caixa cai, por quê, e qual plantão
 * dele vai em troca. Supõe que a oferta é visível para ele (ver `visivelPara`).
 */
export function avaliarOferta(oferta: OfertaAberta, internId: string, ctx: ContextoDoMercado): Avaliacao {
  const a = avaliarPelasRegras(oferta, internId, ctx);
  const peso = ctx.preferencias?.get(internId)?.get(oferta.plantao.baseCode) ?? 0;
  if (a.caixa === "FORA" || peso === 0) return a;
  // A preferência só reordena dentro da caixa: não esconde nem promove oferta.
  return {
    ...a,
    forca: a.forca + (peso > 0 ? 1.5 : -1.5),
    motivo: `${a.motivo} ${peso > 0 ? "É uma das suas bases favoritas." : "É uma base que você prefere evitar."}`,
  };
}

function avaliarPelasRegras(oferta: OfertaAberta, internId: string, ctx: ContextoDoMercado): Avaliacao {
  const o = oferta.plantao;
  const k = chave(o.date, o.period);
  const fora = (motivo: string): Avaliacao => ({ caixa: "FORA", motivo, entregar: null, forca: 0 });

  const meus = plantoesDe(ctx, internId);
  if (meus.some((p) => chave(p.date, p.period) === k)) return fora("Você já está de plantão nesse turno.");

  const outroNoCaminho = sinaisDe(ctx, internId).find(
    (s) => s.signal === "OUTRO_SERVICO" &&
      (chave(s.date, s.period) === k || turnosColados({ date: o.date.slice(0, 10), period: o.period }).includes(chave(s.date, s.period))),
  );
  if (outroNoCaminho) return fora(`Colado no seu outro serviço${outroNoCaminho.label ? ` (${outroNoCaminho.label})` : ""}.`);

  if (o.baseType === "CENTRAL") {
    if (ctx.cotaCruUsada.has(internId)) return fora("Você já trocou um plantão de CRU neste rodízio.");
    if (ctx.cotaCruUsada.has(o.internId)) return fora(`${primeiroNome(oferta.nome)} já trocou um plantão de CRU neste rodízio.`);
  }

  const mesmoTipo = meus.filter(
    (p) => p.baseType === o.baseType && Boolean(p.shift) === Boolean(o.shift) &&
      plantaoTrocavel(p, ctx.agora) && !ctx.bloqueados.has(p.id) &&
      (p.facultyId === o.facultyId || o.baseType === "USA"),
  );
  if (mesmoTipo.length === 0) {
    return fora(`Você não tem plantão de ${TIPO[o.baseType] ?? o.baseType} livre para dar em troca.`);
  }

  const viaveis = mesmoTipo.filter((g) => cabe(ctx, internId, o, g) && cabe(ctx, o.internId, g, o));
  if (viaveis.length === 0) {
    const colado = meus.find(
      (p) => !p.shift && turnosColados({ date: o.date.slice(0, 10), period: o.period }).includes(chave(p.date, p.period)),
    );
    if (colado) return fora(`Colado no seu plantão de ${descrevePlantao(colado)}, que não serve para esta troca.`);
    return fora(`Nenhum plantão seu cabe na escala de ${primeiroNome(oferta.nome)} sem quebrar o descanso de 12h.`);
  }

  // Melhor plantão para dar: o que tira você de uma colisão, depois o que a
  // outra pessoa marcou (Quero antes de Posso), depois o mais próximo.
  const pontos = (g: PlantaoDoMercado) => {
    const sinal = sinalDe(ctx, o.internId, chave(g.date, g.period));
    return (colideComOutroServico(ctx, g) ? 4 : 0) + (sinal?.signal === "QUERO" ? 3 : sinal?.signal === "POSSO" ? 2 : 0);
  };
  const entregar = [...viaveis].sort((a, b) => pontos(b) - pontos(a) || a.date.localeCompare(b.date))[0];
  const resolve = colideComOutroServico(ctx, entregar);
  const sinalDele = sinalDe(ctx, o.internId, chave(entregar.date, entregar.period));
  const meuSinal = sinalDe(ctx, internId, k);
  const quem = primeiroNome(oferta.nome);
  const darTexto = descrevePlantao(entregar);

  // O plantão que vai em troca é justamente o colado no turno da oferta: só dá
  // certo porque ele sai da sua escala.
  const entregaOColado = !entregar.shift &&
    turnosColados({ date: o.date.slice(0, 10), period: o.period }).includes(chave(entregar.date, entregar.period));
  if (entregaOColado) {
    return {
      caixa: "SO_ENTREGANDO",
      motivo: `Colado no seu plantão de ${darTexto}: dá certo se ${quem} ficar com ele.`,
      entregar,
      forca: resolve ? 1 : 0,
    };
  }

  const extraResolve = resolve ? ` E tira você de ${darTexto}, que colide com seu outro serviço.` : "";
  if (meuSinal && (meuSinal.signal === "QUERO" || meuSinal.signal === "POSSO") && sinalDele && sinalDele.signal !== "OUTRO_SERVICO") {
    return {
      caixa: "PERFEITA",
      motivo: `Você marcou ${meuSinal.signal === "QUERO" ? "Quero" : "Posso"} neste turno, e ${quem} marcou ${sinalDele.signal === "QUERO" ? "Quero" : "Posso"} no seu ${darTexto}.${extraResolve}`,
      entregar,
      forca: 10 + (meuSinal.signal === "QUERO" ? 2 : 0) + (resolve ? 4 : 0),
    };
  }
  if (meuSinal && (meuSinal.signal === "QUERO" || meuSinal.signal === "POSSO")) {
    return {
      caixa: "COMBINA",
      motivo: `Você marcou ${meuSinal.signal === "QUERO" ? "Quero" : "Posso"} neste turno.${extraResolve}`,
      entregar,
      forca: (meuSinal.signal === "QUERO" ? 2 : 1) + (resolve ? 4 : 0),
    };
  }
  return {
    caixa: "PODE",
    motivo: resolve
      ? `Tira você de ${darTexto}, que colide com seu outro serviço.`
      : "Você está livre e descansado nesse turno.",
    entregar,
    forca: resolve ? 4 : 0,
  };
}

/**
 * Mesmo recorte do mural de hoje (list-requests.ts): oferta da própria
 * faculdade, de qualquer tipo; de outra faculdade, só USA.
 */
export function visivelPara(oferta: OfertaAberta, internId: string, faculdades: Set<string>): boolean {
  if (oferta.plantao.internId === internId) return false;
  return oferta.plantao.baseType === "USA" || faculdades.has(oferta.plantao.facultyId);
}

export type Interessado = { internId: string; nome: string; sinal: "QUERO" | "POSSO"; perfeita: boolean };

/**
 * O que quem ofertou vê da própria oferta: quantos colegas conseguem fechar a
 * troca, e quem marcou Quero/Posso no turno (só quem consegue fechar).
 * A cota de CRU dos colegas não entra na conta de "podem": medi-la para todo o
 * rodízio custaria três consultas por interno; a proposta checa de novo.
 */
export function resumoDaOferta(oferta: OfertaAberta, ctx: ContextoDoMercado, faculdadeDe: Map<string, Set<string>>) {
  const k = chave(oferta.plantao.date, oferta.plantao.period);
  const candidatos = new Set(ctx.plantoes.map((p) => p.internId));
  candidatos.delete(oferta.plantao.internId);
  let podem = 0;
  const interessados: Interessado[] = [];
  for (const internId of candidatos) {
    if (!visivelPara(oferta, internId, faculdadeDe.get(internId) ?? new Set())) continue;
    const a = avaliarOferta(oferta, internId, { ...ctx, cotaCruUsada: new Set() });
    if (a.caixa === "FORA") continue;
    podem++;
    const s = sinalDe(ctx, internId, k);
    if (s && (s.signal === "QUERO" || s.signal === "POSSO")) {
      interessados.push({ internId, nome: ctx.nomes.get(internId) ?? "Colega", sinal: s.signal, perfeita: a.caixa === "PERFEITA" });
    }
  }
  interessados.sort((a, b) => Number(b.perfeita) - Number(a.perfeita) || (a.sinal === b.sinal ? a.nome.localeCompare(b.nome, "pt-BR") : a.sinal === "QUERO" ? -1 : 1));
  return { podem, interessados };
}

/** Oferta × procura por turno: quantas ofertas abertas e quantas marcações de Quero/Posso. */
export function janelaDeTrocas(params: { de: string; dias: number; ofertas: OfertaAberta[]; sinais: SinalDoMercado[] }) {
  const { de, dias, ofertas, sinais } = params;
  const ofertasPorTurno = new Map<string, number>();
  for (const o of ofertas) {
    const k = chave(o.plantao.date, o.plantao.period);
    ofertasPorTurno.set(k, (ofertasPorTurno.get(k) ?? 0) + 1);
  }
  const procuraPorTurno = new Map<string, number>();
  for (const s of sinais) {
    if (s.signal === "OUTRO_SERVICO") continue;
    const k = chave(s.date, s.period);
    procuraPorTurno.set(k, (procuraPorTurno.get(k) ?? 0) + 1);
  }
  const turnos: { date: string; period: "DAY" | "NIGHT"; ofertas: number; procura: number }[] = [];
  const d0 = new Date(`${de}T12:00:00Z`);
  for (let i = 0; i < dias; i++) {
    const d = new Date(d0);
    d.setUTCDate(d0.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    for (const period of ["DAY", "NIGHT"] as const) {
      const k = chave(date, period);
      turnos.push({ date, period, ofertas: ofertasPorTurno.get(k) ?? 0, procura: procuraPorTurno.get(k) ?? 0 });
    }
  }
  return turnos;
}
