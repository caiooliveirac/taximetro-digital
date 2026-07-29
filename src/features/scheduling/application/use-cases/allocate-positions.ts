/**
 * Pure allocation engine — no DB calls, fully testable.
 *
 * Algorithm: bipartite maximum matching via Hopcroft-Karp augmenting paths
 * so that the maximum number of interns get assigned even when CRU/CRL
 * constraints force some interns to compete for the same limited set of slots.
 */

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
): AllocationMatch[] {
  const availableIdxs: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    if (!positionTaken[i]) availableIdxs.push(i);
  }

  // Build preference lists for each eligible intern
  const preferences = new Map<string, number[]>();
  for (const internId of eligibleInterns) {
    const usaCount = currentUsaShiftCount.get(internId) ?? 0;
    const choices = availableIdxs.filter((idx) =>
      canAssign(internId, positions[idx], usaCount, maxShifts, usedSlots, cruBlocked, isEbmsp, unavailable),
    );
    if (choices.length > 0) preferences.set(internId, choices);
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

  for (const internId of eligibleInterns) {
    if (!preferences.has(internId)) continue;
    tryMatch(internId, new Set<number>());
  }

  // Collect results sorted by position index (priority order)
  const result: AllocationMatch[] = [];
  for (const [internId, posIdx] of matchInternToPos) {
    result.push({ internId, positionIndex: posIdx });
  }
  result.sort((a, b) => a.positionIndex - b.positionIndex);
  return result;
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
    );
    if (roundMatches.length === 0) break;

    for (const m of roundMatches) {
      const pos = positions[m.positionIndex];
      positionTaken[m.positionIndex] = true;

      // Update slot usage
      const key = slotKey(pos, isEbmsp);
      if (!workingUsedSlots.has(m.internId)) workingUsedSlots.set(m.internId, new Set());
      workingUsedSlots.get(m.internId)!.add(key);

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
