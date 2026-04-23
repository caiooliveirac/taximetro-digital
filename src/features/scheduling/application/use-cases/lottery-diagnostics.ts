import type { AllocPos } from "./allocate-positions";

export type UnallocatedReason =
  | "NO_REMAINING_POSITIONS"
  | "MAX_SHIFTS_REACHED"
  | "CRU_12H_CONFLICT"
  | "SLOT_ALREADY_OCCUPIED"
  | "CONSTRAINT_MIXED";

export type UnallocatedDiagnosticItem = {
  internId: string;
  reason: UnallocatedReason;
  reasonLabel: string;
  attempts: {
    positionsChecked: number;
    blockedByCru: number;
    blockedByExistingSlot: number;
  };
};

export type UnallocatedDiagnostics = {
  items: UnallocatedDiagnosticItem[];
  summary: Record<UnallocatedReason, number>;
};

function slotKey(pos: AllocPos, isEbmsp: boolean): string {
  return isEbmsp && pos.shift
    ? `${pos.date}|${pos.period}|${pos.shift}`
    : `${pos.date}|${pos.period}`;
}

function humanReason(reason: UnallocatedReason): string {
  switch (reason) {
    case "NO_REMAINING_POSITIONS":
      return "Sem vagas remanescentes";
    case "MAX_SHIFTS_REACHED":
      return "Já atingiu limite de plantões USA na semana";
    case "CRU_12H_CONFLICT":
      return "Vagas remanescentes conflitam com regulação (CRU/CRL ±12h)";
    case "SLOT_ALREADY_OCCUPIED":
      return "Todos os slots remanescentes já estão ocupados pelo interno";
    case "CONSTRAINT_MIXED":
      return "Sem alocação possível após tentativas por restrições combinadas";
  }
}

export function buildUnallocatedDiagnostics(params: {
  unallocatedInternIds: string[];
  remainingPositions: AllocPos[];
  maxShifts: number;
  isEbmsp: boolean;
  existingUsaShiftCount: Map<string, number>;
  usedSlots: Map<string, Set<string>>;
  cruBlocked: Map<string, Set<string>>;
}): UnallocatedDiagnostics {
  const summary: Record<UnallocatedReason, number> = {
    NO_REMAINING_POSITIONS: 0,
    MAX_SHIFTS_REACHED: 0,
    CRU_12H_CONFLICT: 0,
    SLOT_ALREADY_OCCUPIED: 0,
    CONSTRAINT_MIXED: 0,
  };

  const items: UnallocatedDiagnosticItem[] = [];

  for (const internId of params.unallocatedInternIds) {
    const positionsChecked = params.remainingPositions.length;
    let blockedByCru = 0;
    let blockedByExistingSlot = 0;

    const currentCount = params.existingUsaShiftCount.get(internId) ?? 0;
    const atMax = currentCount >= params.maxShifts;

    if (positionsChecked > 0 && !atMax) {
      for (const pos of params.remainingPositions) {
        const blockedKey = `${pos.date}|${pos.period}`;
        const hasCruConflict =
          pos.baseType !== "CENTRAL" && pos.baseCode !== "CRL" &&
          (params.cruBlocked.get(internId)?.has(blockedKey) ?? false);
        if (hasCruConflict) blockedByCru += 1;

        const occupied = params.usedSlots.get(internId)?.has(slotKey(pos, params.isEbmsp)) ?? false;
        if (occupied) blockedByExistingSlot += 1;
      }
    }

    let reason: UnallocatedReason;
    if (positionsChecked === 0) {
      reason = "NO_REMAINING_POSITIONS";
    } else if (atMax) {
      reason = "MAX_SHIFTS_REACHED";
    } else if (blockedByCru === positionsChecked) {
      reason = "CRU_12H_CONFLICT";
    } else if (blockedByExistingSlot === positionsChecked) {
      reason = "SLOT_ALREADY_OCCUPIED";
    } else {
      reason = "CONSTRAINT_MIXED";
    }

    summary[reason] += 1;
    items.push({
      internId,
      reason,
      reasonLabel: humanReason(reason),
      attempts: {
        positionsChecked,
        blockedByCru,
        blockedByExistingSlot,
      },
    });
  }

  return { items, summary };
}
