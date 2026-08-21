/**
 * Pure allocation engine — no DB calls, fully testable.
 *
 * Algorithm: bipartite maximum matching via Hopcroft-Karp augmenting paths
 * so that the maximum number of interns get assigned even when CRU/CRL
 * constraints force some interns to compete for the same limited set of slots.
 *
 * Equidade (opcional, via `periodTally` e `baseTally`): é objetivo SOFT. Ela
 * escolhe ENTRE as vagas viáveis — nunca remove uma. Por isso não reduz a
 * cardinalidade do emparelhamento nem fura CRU/CRL/maxShifts: quando não dá
 * para equilibrar, o interno leva a vaga que sobrar (1 plantão garantido).
 *
 * Duas coisas ela tenta evitar, nessa ordem de força:
 * 1. o mesmo interno cair mais de uma vez na mesma base
 * 2. o mesmo interno acumular noturnos
 *
 * Ambas viram custo CONVEXO (quadrático): a segunda vez na mesma base custa
 * mais que a primeira, o terceiro noturno custa mais que o segundo. Isso faz o
 * motor espalhar em vez de concentrar. Depois do emparelhamento ainda roda uma
 * busca local de trocas (`melhoraPorTrocas`) que só aceita movimento que baixa
 * o custo — e nunca muda quem foi alocado nem quantas vagas ficaram vazias.
 */

/**
 * Pesos do custo. Custo de um interno =
 *   PESO_BASE_REPETIDA * Σ_base (vezes na base)²  +  PESO_NOTURNO * (noturnos)²
 *
 * Com os dois em 1, a 1ª repetição de base custa 3 e o 1º noturno custa 1:
 * repetir base pesa mais que pegar um noturno, mas o 2º noturno (custo 3) já
 * empata com a repetição. É o equilíbrio pedido — nem noturno demais, nem a
 * mesma base duas vezes.
 */
const PESO_BASE_REPETIDA = 1;
const PESO_NOTURNO = 1;

/** Teto de passadas da busca local. Convergência é rápida; o teto é só trava. */
const MAX_PASSADAS_DE_MELHORIA = 20;

/** Contagem de plantões por base (baseCode) de um interno. */
export type BaseTally = Map<string, number>;

export type PeriodTally = { day: number; night: number };

export type AllocPos = {
  baseId: string;
  baseCode: string;
  baseType: string; // "USA" | "CENTRAL" | "CRL"
  date: string;     // "YYYY-MM-DD"
  period: "DAY" | "NIGHT";
  shift: string | null;
};

export type AllocationInput = {
  /** Available positions (already sorted by priority). */
  positions: AllocPos[];
  /** Intern IDs in desired allocation order (pre-shuffled for fairness). */
  internIds: string[];
  /** Max USA shifts allowed per intern this week (includes pre-existing). */
  maxShifts: number;
  /** Whether to use EBMSP shift-split logic (MORNING/AFTERNOON). */
  isEbmsp: boolean;
  /** Pre-existing USA shift count per intern for this week. */
  existingUsaShiftCount: Map<string, number>;
  /** Per-intern set of already-occupied slot keys ("date|period" or "date|period|shift"). */
  usedSlots: Map<string, Set<string>>;
  /** Per-intern set of CRU/CRL ±12h blocked slot keys ("date|period"). */
  cruBlocked: Map<string, Set<string>>;
  /**
   * Indisponibilidade declarada pelo interno ("date|period"), instância Vitalmed.
   *
   * Diferente de `cruBlocked`, que só vale para alvo USA: aqui o interno disse
   * que NÃO PODE naquele turno, então bloqueia qualquer base. Opcional para não
   * quebrar chamadas existentes — ausente significa nenhuma indisponibilidade.
   */
  unavailable?: Map<string, Set<string>>;
  /**
   * Contagem acumulada de plantões por período (DAY/NIGHT) por interno — usada
   * para equilibrar diurnos/noturnos ao longo de várias semanas (e entre turnos
   * de uma mesma semana quando maxShifts>1). SOFT: só reordena preferências.
   * Opcional — ausente reproduz o comportamento antigo (sem viés de período).
   */
  periodTally?: Map<string, PeriodTally>;
  /**
   * Quantas vezes cada interno já esteve em cada base (`baseCode`), acumulado
   * do histórico recente e das semanas já sorteadas neste lote. SOFT: só
   * escolhe entre vagas viáveis. Ausente reproduz o comportamento antigo.
   */
  baseTally?: Map<string, BaseTally>;
};

export type AllocationMatch = {
  internId: string;
  positionIndex: number;
};

// ── helpers ──────────────────────────────────────────────────────────────────

function slotKey(pos: AllocPos, isEbmsp: boolean): string {
  return isEbmsp && pos.shift
    ? `${pos.date}|${pos.period}|${pos.shift}`
    : `${pos.date}|${pos.period}`;
}

/**
 * Score de "carência de diurno": quanto mais noturnos que diurnos o interno tem,
 * maior o score → ele escolhe primeiro, para alcançar os diurnos antes de acabarem.
 */
function nightNeedScore(tally: PeriodTally | undefined): number {
  if (!tally) return 0;
  return tally.night - tally.day;
}

/**
 * Custo de dar ESTA vaga a um interno que já tem `vezesNaBase` plantões na base
 * dela e `noturnos` noturnos. É a derivada discreta do custo quadrático
 * (n² → (n+1)² cresce 2n+1), então quanto mais repetido, mais caro.
 */
function custoMarginal(pos: AllocPos, vezesNaBase: number, noturnos: number): number {
  const repeticao = PESO_BASE_REPETIDA * (2 * vezesNaBase + 1);
  const noturno = pos.period === "NIGHT" ? PESO_NOTURNO * (2 * noturnos + 1) : 0;
  return repeticao + noturno;
}

/**
 * Acumula os plantões sorteados na contagem por base. Usado pelo use-case para
 * carregar a equidade de bases entre as semanas do mesmo lote.
 */
export function applyMatchesToBaseTally(
  tally: Map<string, BaseTally>,
  matches: Array<{ internId: string; position: AllocPos }>,
): void {
  for (const match of matches) {
    const porBase = tally.get(match.internId) ?? new Map<string, number>();
    const code = match.position.baseCode;
    porBase.set(code, (porBase.get(code) ?? 0) + 1);
    tally.set(match.internId, porBase);
  }
}

/**
 * Atualiza o tally acumulando os períodos dos plantões sorteados. Usado pelo
 * use-case para carregar a equidade entre semanas do mesmo lote.
 */
export function applyMatchesToPeriodTally(
  tally: Map<string, PeriodTally>,
  matches: Array<{ internId: string; position: AllocPos }>,
): void {
  for (const match of matches) {
    const current = tally.get(match.internId) ?? { day: 0, night: 0 };
    if (match.position.period === "DAY") current.day += 1;
    else current.night += 1;
    tally.set(match.internId, current);
  }
}

function canAssign(
  internId: string,
  pos: AllocPos,
  usaShiftCount: number,
  maxShifts: number,
  usedSlots: Map<string, Set<string>>,
  cruBlocked: Map<string, Set<string>>,
  isEbmsp: boolean,
  unavailable?: Map<string, Set<string>>,
): boolean {
  // Already at max USA shifts
  if (usaShiftCount >= maxShifts) return false;

  // Interno declarou indisponibilidade neste turno — bloqueio duro, vale para
  // qualquer tipo de base (ver unavailability-policy.ts).
  if (unavailable?.get(internId)?.has(`${pos.date}|${pos.period}`)) return false;

  // Intern already occupies this exact slot
  const key = slotKey(pos, isEbmsp);
  if (usedSlots.get(internId)?.has(key)) return false;

  // CRU/CRL ±12h rule only applies to USA targets
  if (pos.baseType !== "CENTRAL" && pos.baseCode !== "CRL") {
    if (cruBlocked.get(internId)?.has(`${pos.date}|${pos.period}`)) return false;
  }

  return true;
}

// ── core matching round ───────────────────────────────────────────────────────

/**
 * Run one matching round over all eligible interns vs all still-available positions.
 * Uses Kuhn's augmenting-path bipartite matching to find the MAXIMUM matching.
 *
 * Returns a list of (internId, positionIndex) pairs for this round.
 */
export function runMatchingRound(
  eligibleInterns: string[],
  positions: AllocPos[],
  positionTaken: boolean[],
  maxShifts: number,
  isEbmsp: boolean,
  currentUsaShiftCount: Map<string, number>,
  usedSlots: Map<string, Set<string>>,
  cruBlocked: Map<string, Set<string>>,
  unavailable?: Map<string, Set<string>>,
  periodTally?: Map<string, PeriodTally>,
  baseTally?: Map<string, BaseTally>,
): AllocationMatch[] {
  const availableIdxs: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    if (!positionTaken[i]) availableIdxs.push(i);
  }

  // Equidade (soft): no Kuhn, quem é processado POR ÚLTIMO consegue deslocar os
  // anteriores via caminho de aumento e ficar com a vaga disputada. Por isso os
  // internos mais "devendo" diurno vão por último — assim eles tomam o DAY de quem
  // pode absorver um NIGHT. Sem tally, a ordem é a recebida (shuffle) — comportamento
  // antigo. Array.sort é estável (ES2019+), então empates preservam a ordem de origem.
  const usaEquidade = Boolean(periodTally || baseTally);

  /**
   * Custo de dar a vaga `idx` ao interno. As contagens são as do INÍCIO da
   * rodada — nesta rodada cada interno recebe no máximo uma vaga, então o custo
   * de um não depende do que os outros receberam aqui, e comparar pares é exato.
   */
  const custo = (internId: string, idx: number): number =>
    custoMarginal(
      positions[idx],
      baseTally?.get(internId)?.get(positions[idx].baseCode) ?? 0,
      periodTally?.get(internId)?.night ?? 0,
    );

  const orderedEligible = periodTally
    ? [...eligibleInterns].sort(
        (a, b) => nightNeedScore(periodTally.get(a)) - nightNeedScore(periodTally.get(b)),
      )
    : eligibleInterns;

  // Build preference lists for each eligible intern
  const preferences = new Map<string, number[]>();
  for (const internId of orderedEligible) {
    const usaCount = currentUsaShiftCount.get(internId) ?? 0;
    const choices = availableIdxs.filter((idx) =>
      canAssign(internId, positions[idx], usaCount, maxShifts, usedSlots, cruBlocked, isEbmsp, unavailable),
    );
    if (choices.length === 0) continue;

    // Equidade (soft): tenta primeiro a vaga mais barata (base menos repetida,
    // e noturno só quando o diurno não compensa). Só reordena — todas as vagas
    // viáveis continuam na lista, então a cardinalidade do emparelhamento não
    // muda. Empate cai na ordem de prioridade original (DAY primeiro, melhor
    // base primeiro). Sem tally, mantém a ordem de prioridade original.
    if (usaEquidade && choices.length > 1) {
      choices.sort(
        (leftIdx, rightIdx) =>
          custo(internId, leftIdx) - custo(internId, rightIdx) || leftIdx - rightIdx,
      );
    }

    preferences.set(internId, choices);
  }

  // Kuhn's augmenting-path matching
  const matchPosToIntern = new Map<number, string>();
  const matchInternToPos = new Map<string, number>();

  function tryMatch(internId: string, visited: Set<number>): boolean {
    const choices = preferences.get(internId) ?? [];
    for (const posIdx of choices) {
      if (visited.has(posIdx)) continue;
      visited.add(posIdx);
      const incumbent = matchPosToIntern.get(posIdx);
      if (incumbent === undefined || tryMatch(incumbent, visited)) {
        matchPosToIntern.set(posIdx, internId);
        matchInternToPos.set(internId, posIdx);
        return true;
      }
    }
    return false;
  }

  for (const internId of orderedEligible) {
    if (!preferences.has(internId)) continue;
    tryMatch(internId, new Set<number>());
  }

  if (usaEquidade) {
    melhoraPorTrocas({ matchInternToPos, matchPosToIntern, preferences, custo });
  }

  // Collect results sorted by position index (priority order)
  const result: AllocationMatch[] = [];
  for (const [internId, posIdx] of matchInternToPos) {
    result.push({ internId, positionIndex: posIdx });
  }
  result.sort((a, b) => a.positionIndex - b.positionIndex);
  return result;
}

/**
 * Busca local depois do emparelhamento: "estressa" o resultado procurando
 * trocas que baixem o custo (base repetida / noturno acumulado).
 *
 * Duas jogadas, ambas seguras:
 * - TROCA: dois internos trocam de vaga. O conjunto de vagas preenchidas não
 *   muda, então nem a cardinalidade nem quais vagas ficaram vazias mudam.
 * - MUDANÇA: um interno vai para uma vaga viável que ninguém pegou, e só se
 *   essa vaga for de prioridade MAIOR (índice menor) que a atual — assim a
 *   vaga que fica vazia é sempre a pior das duas, respeitando BASE_PRIORITY.
 *
 * Só aceita movimento estritamente mais barato, então termina. Nenhuma jogada
 * usa vaga fora de `preferences`, que já é a lista de vagas VIÁVEIS do interno
 * (maxShifts, slot ocupado, CRU/CRL, indisponibilidade). Nada é furado aqui.
 */
function melhoraPorTrocas(params: {
  matchInternToPos: Map<string, number>;
  matchPosToIntern: Map<number, string>;
  preferences: Map<string, number[]>;
  custo: (internId: string, posIdx: number) => number;
}): void {
  const { matchInternToPos, matchPosToIntern, preferences, custo } = params;
  const viavel = new Map(
    [...preferences.entries()].map(([internId, idxs]) => [internId, new Set(idxs)]),
  );
  const internos = [...matchInternToPos.keys()];

  for (let passada = 0; passada < MAX_PASSADAS_DE_MELHORIA; passada++) {
    let mudou = false;

    for (const internId of internos) {
      const atual = matchInternToPos.get(internId)!;
      const custoAtual = custo(internId, atual);
      for (const idx of preferences.get(internId) ?? []) {
        if (idx >= atual) continue;
        if (matchPosToIntern.has(idx)) continue;
        if (custo(internId, idx) >= custoAtual) continue;
        matchPosToIntern.delete(atual);
        matchInternToPos.set(internId, idx);
        matchPosToIntern.set(idx, internId);
        mudou = true;
        break;
      }
    }

    for (let i = 0; i < internos.length; i++) {
      for (let j = i + 1; j < internos.length; j++) {
        const a = internos[i];
        const b = internos[j];
        const posA = matchInternToPos.get(a)!;
        const posB = matchInternToPos.get(b)!;
        if (!viavel.get(a)?.has(posB) || !viavel.get(b)?.has(posA)) continue;
        if (custo(a, posB) + custo(b, posA) >= custo(a, posA) + custo(b, posB)) continue;
        matchInternToPos.set(a, posB);
        matchInternToPos.set(b, posA);
        matchPosToIntern.set(posB, a);
        matchPosToIntern.set(posA, b);
        mudou = true;
      }
    }

    if (!mudou) break;
  }
}

// ── top-level allocator ───────────────────────────────────────────────────────

export function allocatePositions(input: AllocationInput): {
  matches: Array<{ internId: string; position: AllocPos }>;
  unallocatedInterns: string[];
  remainingPositions: number;
  remainingPositionsList: AllocPos[];
} {
  const {
    positions,
    internIds,
    maxShifts,
    isEbmsp,
    existingUsaShiftCount,
    usedSlots,
    cruBlocked,
    unavailable,
    periodTally,
    baseTally,
  } = input;

  const positionTaken = new Array<boolean>(positions.length).fill(false);

  // Working copies so we don't mutate the caller's maps
  const currentUsaShiftCount = new Map(existingUsaShiftCount);
  const workingUsedSlots = new Map(
    [...usedSlots.entries()].map(([k, v]) => [k, new Set(v)]),
  );
  const workingCruBlocked = new Map(
    [...cruBlocked.entries()].map(([k, v]) => [k, new Set(v)]),
  );
  // Tally de trabalho (não muta o do caller): vai acumulando os plantões deste
  // lote para equilibrar também entre rodadas quando maxShifts>1.
  const workingTally = periodTally
    ? new Map([...periodTally.entries()].map(([k, v]) => [k, { ...v }]))
    : undefined;
  // Mesma ideia para as bases: acumula o que este lote já deu, para a rodada
  // seguinte não repetir a base que acabou de sair.
  const workingBaseTally = baseTally
    ? new Map([...baseTally.entries()].map(([k, v]) => [k, new Map(v)]))
    : undefined;

  const allMatches: Array<{ internId: string; position: AllocPos }> = [];

  for (let round = 0; round < maxShifts; round++) {
    const eligible = internIds.filter((id) => {
      const count = currentUsaShiftCount.get(id) ?? 0;
      return count < maxShifts;
    });
    if (eligible.length === 0) break;

    const roundMatches = runMatchingRound(
      eligible,
      positions,
      positionTaken,
      maxShifts,
      isEbmsp,
      currentUsaShiftCount,
      workingUsedSlots,
      workingCruBlocked,
      unavailable,
      workingTally,
      workingBaseTally,
    );
    if (roundMatches.length === 0) break;

    for (const m of roundMatches) {
      const pos = positions[m.positionIndex];
      positionTaken[m.positionIndex] = true;

      // Update slot usage
      const key = slotKey(pos, isEbmsp);
      if (!workingUsedSlots.has(m.internId)) workingUsedSlots.set(m.internId, new Set());
      workingUsedSlots.get(m.internId)!.add(key);

      if (workingBaseTally) {
        const porBase = workingBaseTally.get(m.internId) ?? new Map<string, number>();
        porBase.set(pos.baseCode, (porBase.get(pos.baseCode) ?? 0) + 1);
        workingBaseTally.set(m.internId, porBase);
      }

      // Acumula no tally de trabalho para a próxima rodada ver o período sorteado.
      if (workingTally) {
        const current = workingTally.get(m.internId) ?? { day: 0, night: 0 };
        if (pos.period === "DAY") current.day += 1;
        else current.night += 1;
        workingTally.set(m.internId, current);
      }

      // Update USA shift count
      if (pos.baseType === "USA") {
        currentUsaShiftCount.set(m.internId, (currentUsaShiftCount.get(m.internId) ?? 0) + 1);
      }

      // Propagate CRU ±12h blocking for this intern
      if (pos.baseType === "CENTRAL") {
        if (!workingCruBlocked.has(m.internId)) workingCruBlocked.set(m.internId, new Set());
        const blocked = workingCruBlocked.get(m.internId)!;
        blocked.add(`${pos.date}|${pos.period}`);
        if (pos.period === "DAY") {
          const prev = new Date(pos.date + "T12:00:00Z");
          prev.setUTCDate(prev.getUTCDate() - 1);
          blocked.add(`${prev.toISOString().slice(0, 10)}|NIGHT`);
          blocked.add(`${pos.date}|NIGHT`);
        } else {
          const next = new Date(pos.date + "T12:00:00Z");
          next.setUTCDate(next.getUTCDate() + 1);
          blocked.add(`${pos.date}|DAY`);
          blocked.add(`${next.toISOString().slice(0, 10)}|DAY`);
        }
      }

      allMatches.push({ internId: m.internId, position: pos });
    }
  }

  const allocatedInterns = new Set(allMatches.map((m) => m.internId));
  const unallocatedInterns = internIds.filter((id) => !allocatedInterns.has(id));
  const remainingPositionsList = positions.filter((_, idx) => !positionTaken[idx]);
  const remainingPositions = remainingPositionsList.length;

  return { matches: allMatches, unallocatedInterns, remainingPositions, remainingPositionsList };
}
