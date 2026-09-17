/**
 * Sorteio do lote inteiro — puro, sem banco.
 *
 * O sorteio de N semanas era N sorteios de uma semana, cada um enxergando só o
 * que os anteriores deixaram. Aqui o lote é um problema só:
 *
 * 1. CARDINALIDADE, semana a semana, com o emparelhamento máximo de
 *    `allocatePositions`: ninguém fica sem plantão se havia vaga viável. Quem
 *    tem menos plantões no lote entra primeiro, então quem sobrou numa semana
 *    tem a vez na seguinte.
 * 2. JUSTIÇA, no lote todo: busca local de trocas entre quaisquer semanas. Só
 *    aceita jogada que baixa o custo e que passa nas MESMAS regras duras da
 *    fase 1 (`canAssign`: slot ocupado, CRU/CRL ±12h, 12h entre USAs,
 *    indisponibilidade, teto semanal). Nenhuma jogada esvazia vaga — o número
 *    de plantões de cada semana sai da fase 1 e não muda.
 *
 * O que o custo mede, por interno (tudo só sobre plantão sorteável — CRU/CRL
 * fixo fica fora, é igual para todo mundo da turma):
 * - plantões no lote, contra a média                       → rodízio de quem sobra
 * - noturnos, contra a cota dele (proporção do lote × plantões dele)
 * - qualidade das bases, contra a cota dele (média do lote × plantões dele)
 * - vezes na mesma base, ao quadrado                        → não repetir base
 */

import { allocatePositions, canAssign, type AllocPos } from "./allocate-positions";

const PESO_PLANTOES = 6;
const PESO_NOTURNO = 3;
const PESO_QUALIDADE = 3;
const PESO_BASE_REPETIDA = 1;

/** Sorteios independentes por lote; fica o de menor custo. */
const TENTATIVAS = 6;
const MAX_PASSADAS = 40;

/** O que o interno já fez de plantão sorteável antes deste lote (histórico). */
export type HistoricoDoInterno = {
  plantoes: number;
  noturnos: number;
  /** vezes em cada base (baseCode) */
  bases: Map<string, number>;
};

export type HorizonInput = {
  /** Vagas de cada semana, já ordenadas por prioridade (ver buildWeekPositions). */
  positionsByWeek: AllocPos[][];
  internIds: string[];
  /** Teto de plantões USA por semana (inclui os que já existem). */
  maxShifts: number;
  isEbmsp: boolean;
  /** Plantões USA que cada interno já tem, por semana. */
  existingUsaShiftCountByWeek: Array<Map<string, number>>;
  /** Slots já ocupados no banco, por interno ("date|period" ou "date|period|shift"). */
  usedSlots: Map<string, Set<string>>;
  cruBlocked: Map<string, Set<string>>;
  unavailable?: Map<string, Set<string>>;
  historico?: Map<string, HistoricoDoInterno>;
  /** Nota da base, 0 (pior) a 1 (melhor). Base sem nota não entra na conta de qualidade. */
  qualidade: (baseCode: string) => number | null;
  /** Semente do sorteio — mesma semente, mesmo resultado. Vai para o audit. */
  seed: number;
};

export type HorizonMatch = { internId: string; position: AllocPos; week: number };

export type ResumoDoInterno = {
  internId: string;
  plantoes: number;
  noturnos: number;
  /** média da nota das bases dele no lote (0 a 1), null se nenhuma tinha nota */
  qualidadeMedia: number | null;
  basesRepetidas: number;
};

export type HorizonResult = {
  matches: HorizonMatch[];
  emptyByWeek: AllocPos[][];
  seed: number;
  custo: number;
  justica: {
    /** faixa justa de noturnos para quem tem o nº típico de plantões */
    noturnosIdeal: { min: number; max: number };
    noturnos: { min: number; max: number };
    plantoes: { min: number; max: number };
    qualidadeMedia: { min: number; max: number } | null;
    basesRepetidas: number;
    porInterno: ResumoDoInterno[];
  };
};

/** PRNG pequeno e determinístico (mulberry32). */
export function criaRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function embaralha<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function chaveDoSlot(pos: AllocPos, isEbmsp: boolean): string {
  return isEbmsp && pos.shift ? `${pos.date}|${pos.period}|${pos.shift}` : `${pos.date}|${pos.period}`;
}

type Vaga = { pos: AllocPos; week: number; prioridade: number };

export function sortearHorizonte(input: HorizonInput): HorizonResult {
  let melhor: HorizonResult | null = null;
  for (let t = 0; t < TENTATIVAS; t++) {
    const tentativa = umaTentativa(input, input.seed + t);
    if (!melhor || tentativa.custo < melhor.custo) melhor = tentativa;
  }
  return { ...melhor!, seed: input.seed };
}

function umaTentativa(input: HorizonInput, seed: number): HorizonResult {
  const { positionsByWeek, internIds, maxShifts, isEbmsp, usedSlots, cruBlocked, unavailable } = input;
  const rng = criaRng(seed);

  const vagas: Vaga[] = [];
  positionsByWeek.forEach((positions, week) =>
    positions.forEach((pos, prioridade) => vagas.push({ pos, week, prioridade })),
  );
  const dono: Array<string | null> = new Array(vagas.length).fill(null);
  const doInterno = new Map<string, Set<number>>(internIds.map((id) => [id, new Set<number>()]));

  // ── fase 1: emparelhamento máximo por semana ───────────────────────────────
  const ocupados = new Map([...usedSlots.entries()].map(([k, v]) => [k, new Set(v)]));
  let offset = 0;
  positionsByWeek.forEach((positions, week) => {
    // Sem tally o motor respeita a ordem recebida, e no Kuhn quem entra primeiro
    // não perde a vaga: menos plantões no lote = entra primeiro.
    const ordem = embaralha(internIds, rng).sort(
      (a, b) => doInterno.get(a)!.size - doInterno.get(b)!.size,
    );
    const { matches } = allocatePositions({
      positions,
      internIds: ordem,
      maxShifts,
      isEbmsp,
      existingUsaShiftCount: input.existingUsaShiftCountByWeek[week] ?? new Map(),
      usedSlots: ocupados,
      cruBlocked,
      unavailable,
    });
    const livres = positions.map((_, i) => i);
    for (const match of matches) {
      const local = livres.find((i) => positions[i] === match.position && dono[offset + i] === null)!;
      dono[offset + local] = match.internId;
      doInterno.get(match.internId)!.add(offset + local);
      if (!ocupados.has(match.internId)) ocupados.set(match.internId, new Set());
      ocupados.get(match.internId)!.add(chaveDoSlot(match.position, isEbmsp));
    }
    offset += positions.length;
  });

  // ── custo ──────────────────────────────────────────────────────────────────
  const hist = (id: string): HistoricoDoInterno =>
    input.historico?.get(id) ?? { plantoes: 0, noturnos: 0, bases: new Map() };

  let totalPlantoes = 0;
  let totalNoturnos = 0;
  let somaQualidade = 0;
  let comQualidade = 0;
  for (const id of internIds) {
    totalPlantoes += hist(id).plantoes;
    totalNoturnos += hist(id).noturnos;
  }
  let plantoesDoLote = 0;
  dono.forEach((id, idx) => {
    if (id === null) return;
    plantoesDoLote += 1;
    totalPlantoes += 1;
    if (vagas[idx].pos.period === "NIGHT") totalNoturnos += 1;
    const nota = input.qualidade(vagas[idx].pos.baseCode);
    if (nota !== null) { somaQualidade += nota; comQualidade += 1; }
  });
  const proporcaoNoturno = totalPlantoes > 0 ? totalNoturnos / totalPlantoes : 0;
  const qualidadeMediaDoLote = comQualidade > 0 ? somaQualidade / comQualidade : 0;
  const mediaDePlantoes = internIds.length > 0 ? plantoesDoLote / internIds.length : 0;

  function custoDe(id: string, idxs: Iterable<number>): number {
    const h = hist(id);
    let noLote = 0;
    let noturnos = h.noturnos;
    let notas = 0;
    let comNota = 0;
    const bases = new Map(h.bases);
    for (const idx of idxs) {
      const pos = vagas[idx].pos;
      noLote += 1;
      if (pos.period === "NIGHT") noturnos += 1;
      const nota = input.qualidade(pos.baseCode);
      if (nota !== null) { notas += nota; comNota += 1; }
      bases.set(pos.baseCode, (bases.get(pos.baseCode) ?? 0) + 1);
    }
    let repeticao = 0;
    for (const vezes of bases.values()) repeticao += vezes * vezes;
    const desvioPlantoes = noLote - mediaDePlantoes;
    const desvioNoturno = noturnos - proporcaoNoturno * (h.plantoes + noLote);
    const desvioQualidade = notas - qualidadeMediaDoLote * comNota;
    return PESO_PLANTOES * desvioPlantoes ** 2
      + PESO_NOTURNO * desvioNoturno ** 2
      + PESO_QUALIDADE * desvioQualidade ** 2
      + PESO_BASE_REPETIDA * repeticao;
  }

  // ── viabilidade: as mesmas regras duras da fase 1, com o lote atual ────────
  function pode(id: string, alvo: number, largando: number | null): boolean {
    const vaga = vagas[alvo];
    const slots = new Set(usedSlots.get(id) ?? []);
    let naSemana = input.existingUsaShiftCountByWeek[vaga.week]?.get(id) ?? 0;
    for (const idx of doInterno.get(id) ?? []) {
      if (idx === largando) continue;
      slots.add(chaveDoSlot(vagas[idx].pos, isEbmsp));
      if (vagas[idx].week === vaga.week) naSemana += 1;
      // Central sorteada (EBMSP) também trava a USA colada nela — é o que a
      // fase 1 faz ao propagar o bloqueio; `slots` acima já cobre.
    }
    return canAssign(id, vaga.pos, naSemana, maxShifts, new Map([[id, slots]]), cruBlocked, isEbmsp, unavailable);
  }

  function sem(idxs: Set<number>, tira: number, poe?: number): number[] {
    const lista = [...idxs].filter((i) => i !== tira);
    if (poe !== undefined) lista.push(poe);
    return lista;
  }

  function entrega(idx: number, novo: string) {
    const antigo = dono[idx];
    if (antigo !== null) doInterno.get(antigo)!.delete(idx);
    dono[idx] = novo;
    doInterno.get(novo)!.add(idx);
  }

  // ── fase 2: busca local no lote inteiro ────────────────────────────────────
  const EPS = 1e-9;
  for (let passada = 0; passada < MAX_PASSADAS; passada++) {
    let mudou = false;
    const preenchidas = embaralha(dono.flatMap((id, idx) => (id === null ? [] : [idx])), rng);

    // TROCA: dois internos trocam de vaga, em qualquer semana.
    for (let x = 0; x < preenchidas.length; x++) {
      for (let y = x + 1; y < preenchidas.length; y++) {
        const i = preenchidas[x];
        const j = preenchidas[y];
        const a = dono[i]!;
        const b = dono[j]!;
        if (a === b) continue;
        const mesmoPerfil = vagas[i].pos.baseCode === vagas[j].pos.baseCode
          && vagas[i].pos.period === vagas[j].pos.period;
        if (mesmoPerfil) continue;
        const antes = custoDe(a, doInterno.get(a)!) + custoDe(b, doInterno.get(b)!);
        const depois = custoDe(a, sem(doInterno.get(a)!, i, j)) + custoDe(b, sem(doInterno.get(b)!, j, i));
        if (depois >= antes - EPS) continue;
        if (!pode(a, j, i) || !pode(b, i, j)) continue;
        entrega(i, b);
        entrega(j, a);
        mudou = true;
      }
    }

    // PASSA A VEZ: a vaga de quem tem plantão demais vai para quem tem de menos.
    for (const i of preenchidas) {
      const a = dono[i]!;
      for (const b of internIds) {
        if (b === a) continue;
        if (doInterno.get(b)!.size >= doInterno.get(a)!.size) continue;
        const antes = custoDe(a, doInterno.get(a)!) + custoDe(b, doInterno.get(b)!);
        const depois = custoDe(a, sem(doInterno.get(a)!, i)) + custoDe(b, [...doInterno.get(b)!, i]);
        if (depois >= antes - EPS) continue;
        if (!pode(b, i, null)) continue;
        entrega(i, b);
        mudou = true;
        break;
      }
    }

    // SOBE: vai para vaga vazia da mesma semana, só se for de prioridade maior —
    // a vaga que fica vazia é sempre a pior das duas (respeita BASE_PRIORITY).
    for (const i of preenchidas) {
      const a = dono[i];
      if (a === null) continue;
      for (let e = 0; e < vagas.length; e++) {
        if (dono[e] !== null) continue;
        if (vagas[e].week !== vagas[i].week || vagas[e].prioridade >= vagas[i].prioridade) continue;
        if (custoDe(a, sem(doInterno.get(a)!, i, e)) >= custoDe(a, doInterno.get(a)!) - EPS) continue;
        if (!pode(a, e, i)) continue;
        doInterno.get(a)!.delete(i);
        dono[i] = null;
        entrega(e, a);
        mudou = true;
        break;
      }
    }

    if (!mudou) break;
  }

  // ── resultado ──────────────────────────────────────────────────────────────
  const matches: HorizonMatch[] = [];
  const emptyByWeek: AllocPos[][] = positionsByWeek.map(() => []);
  dono.forEach((id, idx) => {
    if (id === null) emptyByWeek[vagas[idx].week].push(vagas[idx].pos);
    else matches.push({ internId: id, position: vagas[idx].pos, week: vagas[idx].week });
  });

  let custo = 0;
  const porInterno: ResumoDoInterno[] = internIds.map((id) => {
    const idxs = [...doInterno.get(id)!];
    custo += custoDe(id, idxs);
    const notas = idxs.map((i) => input.qualidade(vagas[i].pos.baseCode)).filter((n): n is number => n !== null);
    const vezes = new Map<string, number>();
    for (const i of idxs) vezes.set(vagas[i].pos.baseCode, (vezes.get(vagas[i].pos.baseCode) ?? 0) + 1);
    return {
      internId: id,
      plantoes: idxs.length,
      noturnos: idxs.filter((i) => vagas[i].pos.period === "NIGHT").length,
      qualidadeMedia: notas.length > 0 ? notas.reduce((s, n) => s + n, 0) / notas.length : null,
      basesRepetidas: [...vezes.values()].reduce((s, v) => s + Math.max(0, v - 1), 0),
    };
  });

  const faixa = (valores: number[]) =>
    valores.length > 0 ? { min: Math.min(...valores), max: Math.max(...valores) } : { min: 0, max: 0 };
  const noturnosDoLote = matches.filter((m) => m.position.period === "NIGHT").length;
  const cotaNoturno = internIds.length > 0 ? noturnosDoLote / internIds.length : 0;
  const medias = porInterno.map((r) => r.qualidadeMedia).filter((n): n is number => n !== null);

  return {
    matches,
    emptyByWeek,
    seed,
    custo,
    justica: {
      noturnosIdeal: { min: Math.floor(cotaNoturno), max: Math.ceil(cotaNoturno) },
      noturnos: faixa(porInterno.map((r) => r.noturnos)),
      plantoes: faixa(porInterno.map((r) => r.plantoes)),
      qualidadeMedia: medias.length > 0 ? faixa(medias) : null,
      basesRepetidas: porInterno.reduce((s, r) => s + r.basesRepetidas, 0),
      porInterno,
    },
  };
}
