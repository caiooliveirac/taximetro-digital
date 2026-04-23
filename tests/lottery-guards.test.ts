import test from "node:test";
import assert from "node:assert/strict";
import { allocatePositions, type AllocPos } from "../src/features/scheduling/application/use-cases/allocate-positions";
import { shouldIncludeRuleInLottery } from "../src/features/scheduling/application/use-cases/run-leader-lottery";
import { buildUnallocatedDiagnostics } from "../src/features/scheduling/application/use-cases/lottery-diagnostics";

function pos(baseCode: string, date: string, period: "DAY" | "NIGHT"): AllocPos {
  return {
    baseId: baseCode,
    baseCode,
    baseType: "USA",
    date,
    period,
    shift: null,
  };
}

test("lottery rule guard: non-EBMSP never includes CENTRAL/CRL in lottery", () => {
  assert.equal(shouldIncludeRuleInLottery({ baseType: "USA", period: "DAY" }, false), true);
  assert.equal(shouldIncludeRuleInLottery({ baseType: "CENTRAL", period: "DAY" }, false), false);
  assert.equal(shouldIncludeRuleInLottery({ baseType: "CRL", period: "NIGHT" }, false), false);
});

test("lottery rule guard: EBMSP includes CENTRAL only on DAY", () => {
  assert.equal(shouldIncludeRuleInLottery({ baseType: "CENTRAL", period: "DAY" }, true), true);
  assert.equal(shouldIncludeRuleInLottery({ baseType: "CENTRAL", period: "NIGHT" }, true), false);
});

test("allocation + diagnostics: intern blocked by CRU ±12h remains unallocated with explicit reason", () => {
  const interns = ["intern-a"];
  const positions = [
    pos("SM01", "2026-04-27", "DAY"),
    pos("PM04", "2026-04-28", "DAY"),
  ];

  const usedSlots = new Map<string, Set<string>>([["intern-a", new Set()]]);
  const cruBlocked = new Map<string, Set<string>>([
    ["intern-a", new Set(["2026-04-27|DAY", "2026-04-28|DAY"])],
  ]);
  const existingUsaShiftCount = new Map<string, number>([["intern-a", 0]]);

  const result = allocatePositions({
    positions,
    internIds: interns,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount,
    usedSlots,
    cruBlocked,
  });

  assert.equal(result.matches.length, 0);
  assert.deepEqual(result.unallocatedInterns, ["intern-a"]);

  const diagnostics = buildUnallocatedDiagnostics({
    unallocatedInternIds: result.unallocatedInterns,
    remainingPositions: result.remainingPositionsList,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount,
    usedSlots,
    cruBlocked,
  });

  assert.equal(diagnostics.items.length, 1);
  assert.equal(diagnostics.items[0]?.reason, "CRU_12H_CONFLICT");
  assert.match(diagnostics.items[0]?.reasonLabel ?? "", /CRU\/CRL/i);
  assert.equal(diagnostics.items[0]?.attempts.blockedByCru, 2);
});

test("diagnostics: intern at cap reports MAX_SHIFTS_REACHED", () => {
  const diagnostics = buildUnallocatedDiagnostics({
    unallocatedInternIds: ["intern-cap"],
    remainingPositions: [pos("SM01", "2026-04-27", "DAY")],
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: new Map([["intern-cap", 1]]),
    usedSlots: new Map([["intern-cap", new Set<string>()]]),
    cruBlocked: new Map([["intern-cap", new Set<string>()]]),
  });

  assert.equal(diagnostics.items[0]?.reason, "MAX_SHIFTS_REACHED");
  assert.equal(diagnostics.summary.MAX_SHIFTS_REACHED, 1);
});
