/**
 * Tests for the lottery allocation engine (allocate-positions.ts)
 *
 * Run with:  npx tsx src/features/scheduling/__tests__/lottery-allocation.test.ts
 */

import assert from "node:assert/strict";
import {
  allocatePositions,
  applyMatchesToPeriodTally,
  type AllocPos,
  type PeriodTally,
} from "../application/use-cases/allocate-positions";

// ── helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    if (err instanceof Error) console.log(`     ${err.message}`);
    failed++;
  }
}

function makePos(
  id: string,
  date: string,
  period: "DAY" | "NIGHT",
  baseType: "USA" | "CENTRAL" | "CRL" = "USA",
): AllocPos {
  return { baseId: id, baseCode: id, baseType, date, period, shift: null };
}

function empty(ids: string[]): Map<string, Set<string>> {
  return new Map(ids.map((id) => [id, new Set<string>()]));
}

function zeroCounts(ids: string[]): Map<string, number> {
  return new Map(ids.map((id) => [id, 0]));
}

// ── Section 1: basic allocation ───────────────────────────────────────────────

console.log("\n── Section 1: basic allocation ─────────────────────────────");

test("all interns allocated when positions >= interns (simple, no constraints)", () => {
  const interns = ["A", "B", "C", "D"];
  const positions: AllocPos[] = [
    makePos("P1", "2026-04-21", "DAY"),
    makePos("P2", "2026-04-21", "NIGHT"),
    makePos("P3", "2026-04-22", "DAY"),
    makePos("P4", "2026-04-22", "NIGHT"),
    makePos("P5", "2026-04-23", "DAY"), // spare
  ];

  const { matches, unallocatedInterns, remainingPositions } = allocatePositions({
    positions,
    internIds: interns,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked: empty(interns),
  });

  assert.equal(matches.length, 4, `expected 4 matches, got ${matches.length}`);
  assert.equal(unallocatedInterns.length, 0, `expected 0 unallocated, got ${JSON.stringify(unallocatedInterns)}`);
  assert.equal(remainingPositions, 1, `expected 1 remaining, got ${remainingPositions}`);
});

test("26 interns, 28 positions, no constraints → all 26 allocated", () => {
  const N = 26;
  const interns = Array.from({ length: N }, (_, i) => `intern-${i}`);
  const positions: AllocPos[] = Array.from({ length: 28 }, (_, i) =>
    makePos(`P${i}`, `2026-04-${21 + (i % 7)}`, i % 2 === 0 ? "DAY" : "NIGHT"),
  );

  const { matches, unallocatedInterns } = allocatePositions({
    positions,
    internIds: interns,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked: empty(interns),
  });

  assert.equal(
    unallocatedInterns.length,
    0,
    `expected 0 unallocated, got ${unallocatedInterns.length}: ${JSON.stringify(unallocatedInterns)}`,
  );
  assert.equal(matches.length, N);
});

// ── Section 2: CRU blocking forces augmenting paths ──────────────────────────

console.log("\n── Section 2: CRU augmenting paths ─────────────────────────");

test("intern blocked from high-priority slot is moved via augmenting path", () => {
  // A can only go to MON-DAY (CRU blocks everything else)
  // B can go to MON-DAY or TUE-DAY
  // With greedy (B first, B takes MON-DAY), A would fail
  // With augmenting paths: A displaces B to TUE-DAY
  const interns = ["A", "B"];
  const positions: AllocPos[] = [
    makePos("BASE1", "2026-04-21", "DAY"),  // MON DAY  → idx 0
    makePos("BASE2", "2026-04-22", "DAY"),  // TUE DAY  → idx 1
  ];

  const cruBlocked = new Map<string, Set<string>>([
    ["A", new Set(["2026-04-22|DAY"])], // A blocked from TUE DAY
    ["B", new Set()],
  ]);

  const { matches, unallocatedInterns } = allocatePositions({
    positions,
    internIds: ["B", "A"], // B processed first — would greedily take MON-DAY
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked,
  });

  assert.equal(unallocatedInterns.length, 0, `A should have been allocated via augmenting path. Unallocated: ${JSON.stringify(unallocatedInterns)}`);
  assert.equal(matches.length, 2);
});

test("3 interns where greedy fails but max matching = 3", () => {
  // Classic case: A→P1 only; B→P1 or P2; C→P2 or P3
  // Greedy (A,B,C): A→P1, B→P2, C→P3 ✓
  // Greedy (B,A,C): B→P1, A→? (blocked from P2 via CRU), fails
  // With augmenting: B→P1, A tries P1→displaces B to P2, C→P3 ✓
  const interns = ["A", "B", "C"];
  const positions: AllocPos[] = [
    makePos("P1", "2026-04-21", "DAY"),
    makePos("P2", "2026-04-22", "DAY"),
    makePos("P3", "2026-04-23", "DAY"),
  ];

  const cruBlocked = new Map<string, Set<string>>([
    ["A", new Set(["2026-04-22|DAY", "2026-04-23|DAY"])], // A can ONLY go to P1
    ["B", new Set()],
    ["C", new Set(["2026-04-21|DAY"])], // C cannot go to P1
  ]);

  for (const order of [
    ["A", "B", "C"],
    ["B", "A", "C"],
    ["C", "B", "A"],
    ["B", "C", "A"],
  ]) {
    const { unallocatedInterns } = allocatePositions({
      positions,
      internIds: order,
      maxShifts: 1,
      isEbmsp: false,
      existingUsaShiftCount: zeroCounts(interns),
      usedSlots: empty(interns),
      cruBlocked,
    });
    assert.equal(
      unallocatedInterns.length,
      0,
      `Order ${order}: expected all allocated, unallocated=${JSON.stringify(unallocatedInterns)}`,
    );
  }
});

// ── Section 3: the critical "2 left, 4 positions, 0 allocated" scenario ──────

console.log("\n── Section 3: critical leftover scenario ────────────────────");

test("2 interns each blocked from 2 of 4 positions, different blocks → both allocated", () => {
  // A is blocked from P3 and P4 (can go to P1 or P2)
  // B is blocked from P1 and P2 (can go to P3 or P4)
  // Both should get allocated
  const interns = ["A", "B"];
  const positions: AllocPos[] = [
    makePos("P1", "2026-04-21", "DAY"),
    makePos("P2", "2026-04-21", "NIGHT"),
    makePos("P3", "2026-04-22", "DAY"),
    makePos("P4", "2026-04-22", "NIGHT"),
  ];
  const cruBlocked = new Map<string, Set<string>>([
    ["A", new Set(["2026-04-22|DAY", "2026-04-22|NIGHT"])],
    ["B", new Set(["2026-04-21|DAY", "2026-04-21|NIGHT"])],
  ]);

  const { unallocatedInterns, matches } = allocatePositions({
    positions,
    internIds: interns,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked,
  });

  assert.equal(unallocatedInterns.length, 0, `both should be allocated, got: ${JSON.stringify(unallocatedInterns)}`);
  assert.equal(matches.length, 2);
});

test("2 interns competing for same 2 of 4 positions, other 2 blocked for both → 2 allocated", () => {
  // A: can go to P1 or P2 only (blocked from P3, P4)
  // B: can go to P1 or P2 only (blocked from P3, P4)
  // C and D also blocked from P3, P4 — but only A and B are in the pool here
  // Max matching = 2 (P1→one, P2→other)
  const interns = ["A", "B"];
  const positions: AllocPos[] = [
    makePos("P1", "2026-04-21", "DAY"),
    makePos("P2", "2026-04-21", "NIGHT"),
    makePos("P3", "2026-04-22", "DAY"),
    makePos("P4", "2026-04-22", "NIGHT"),
  ];
  const cruBlocked = new Map<string, Set<string>>([
    ["A", new Set(["2026-04-22|DAY", "2026-04-22|NIGHT"])],
    ["B", new Set(["2026-04-22|DAY", "2026-04-22|NIGHT"])],
  ]);

  const { unallocatedInterns, matches } = allocatePositions({
    positions,
    internIds: interns,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked,
  });

  assert.equal(matches.length, 2, `both should be allocated among P1/P2`);
  assert.equal(unallocatedInterns.length, 0, `got unallocated: ${JSON.stringify(unallocatedInterns)}`);
});

test("26 interns 28 positions where 4 have heavy CRU blocks → still all 26 allocated", () => {
  // 26 interns; interns 0-3 have CRU blocks on MON-TUE (blocked from P0-P7)
  // 28 positions: P0-P7 are MON/TUE DAY/NIGHT, P8-P27 are WED-SUN
  // After greedy takes P0-P7 for interns 4-11, interns 0-3 have P8-P27 left → fine
  // With blocking: interns 0-3 CANNOT go to P0-P7 but can go to P8-P27
  // All 26 should be allocated
  const N = 26;
  const interns = Array.from({ length: N }, (_, i) => `i${i}`);

  const positions: AllocPos[] = [
    // P0-P7: MON-TUE
    makePos("B0", "2026-04-21", "DAY"),
    makePos("B1", "2026-04-21", "NIGHT"),
    makePos("B2", "2026-04-21", "DAY"),
    makePos("B3", "2026-04-21", "NIGHT"),
    makePos("B4", "2026-04-22", "DAY"),
    makePos("B5", "2026-04-22", "NIGHT"),
    makePos("B6", "2026-04-22", "DAY"),
    makePos("B7", "2026-04-22", "NIGHT"),
    // P8-P27: WED-SUN (plenty of options)
    ...Array.from({ length: 20 }, (_, i) =>
      makePos(`C${i}`, `2026-04-2${3 + (i % 4)}`, i % 2 === 0 ? "DAY" : "NIGHT"),
    ),
  ];

  // interns 0-3 are blocked from MON and TUE slots
  const cruBlocked = new Map<string, Set<string>>(
    interns.map((id, i) => [
      id,
      i < 4
        ? new Set(["2026-04-21|DAY", "2026-04-21|NIGHT", "2026-04-22|DAY", "2026-04-22|NIGHT"])
        : new Set<string>(),
    ]),
  );

  const { unallocatedInterns } = allocatePositions({
    positions,
    internIds: [...interns].reverse(), // worst order: heavily-blocked last
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked,
  });

  assert.equal(
    unallocatedInterns.length,
    0,
    `all 26 should be allocated. unallocated: ${JSON.stringify(unallocatedInterns)}`,
  );
});

// ── Section 4: idempotency ────────────────────────────────────────────────────

console.log("\n── Section 4: idempotency ───────────────────────────────────");

test("re-running with previously allocated interns at cap gives 0 new", () => {
  const interns = ["A", "B", "C"];
  const positions: AllocPos[] = [
    makePos("P1", "2026-04-21", "DAY"),
    makePos("P2", "2026-04-22", "DAY"),
    makePos("P3", "2026-04-23", "DAY"),
  ];

  // First run: all get 1 USA shift
  const { matches: firstRun } = allocatePositions({
    positions,
    internIds: interns,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked: empty(interns),
  });
  assert.equal(firstRun.length, 3, "first run should allocate all 3");

  // Simulate second run: all interns already have 1 USA shift
  const existingCounts = new Map(interns.map((id) => [id, 1]));
  const { matches: secondRun } = allocatePositions({
    positions: [], // no remaining positions either
    internIds: interns,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: existingCounts,
    usedSlots: empty(interns),
    cruBlocked: empty(interns),
  });
  assert.equal(secondRun.length, 0, "second run should allocate 0 (all at cap)");
});

// ── Section 5: maxShifts=2 works correctly ─────────────────────────────────

console.log("\n── Section 5: maxShifts = 2 ─────────────────────────────────");

test("maxShifts=2 allocates up to 2 USA slots per intern", () => {
  const interns = ["A", "B"];
  const positions: AllocPos[] = [
    makePos("P1", "2026-04-21", "DAY"),
    makePos("P2", "2026-04-22", "DAY"),
    makePos("P3", "2026-04-23", "DAY"),
    makePos("P4", "2026-04-24", "DAY"),
  ];

  const { matches } = allocatePositions({
    positions,
    internIds: interns,
    maxShifts: 2,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked: empty(interns),
  });

  assert.equal(matches.length, 4, "2 interns × 2 shifts = 4 total");
  const countA = matches.filter((m) => m.internId === "A").length;
  const countB = matches.filter((m) => m.internId === "B").length;
  assert.equal(countA, 2, `A should have 2 shifts, got ${countA}`);
  assert.equal(countB, 2, `B should have 2 shifts, got ${countB}`);
});

// ── Section 6: fairness diurno/noturno (objetivo SOFT) ───────────────────────

console.log("\n── Section 6: fairness diurno/noturno ─────────────────────");

function tally(entries: Record<string, PeriodTally>): Map<string, PeriodTally> {
  return new Map(Object.entries(entries));
}

test("interno 'devendo' diurno fura a fila e pega o DAY (independe da ordem de entrada)", () => {
  // A está night-heavy (2 noturnos, 0 diurno); B está equilibrado. Mesmo com B
  // entrando primeiro, A deve pegar o DAY por carência.
  const interns = ["A", "B"];
  const positions: AllocPos[] = [
    makePos("P1", "2026-04-21", "DAY"),
    makePos("P2", "2026-04-21", "NIGHT"),
  ];

  const { matches, unallocatedInterns } = allocatePositions({
    positions,
    internIds: ["B", "A"], // B primeiro de propósito
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked: empty(interns),
    periodTally: tally({ A: { day: 0, night: 2 }, B: { day: 1, night: 1 } }),
  });

  assert.equal(unallocatedInterns.length, 0);
  const aMatch = matches.find((m) => m.internId === "A");
  assert.equal(aMatch?.position.period, "DAY", "A (night-heavy) deveria pegar DAY");
});

test("com 2 plantões, ninguém fica 100% de um período (balanceia dentro da semana)", () => {
  const interns = ["A", "B"];
  const positions: AllocPos[] = [
    makePos("D1", "2026-04-21", "DAY"),
    makePos("N1", "2026-04-21", "NIGHT"),
    makePos("D2", "2026-04-22", "DAY"),
    makePos("N2", "2026-04-22", "NIGHT"),
  ];

  const { matches } = allocatePositions({
    positions,
    internIds: interns,
    maxShifts: 2,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked: empty(interns),
    periodTally: tally({ A: { day: 0, night: 0 }, B: { day: 0, night: 0 } }),
  });

  for (const id of interns) {
    const mine = matches.filter((m) => m.internId === id);
    const days = mine.filter((m) => m.position.period === "DAY").length;
    const nights = mine.filter((m) => m.position.period === "NIGHT").length;
    assert.equal(mine.length, 2, `${id} deveria ter 2 plantões`);
    assert.equal(days, 1, `${id} deveria ter 1 DAY, got ${days}`);
    assert.equal(nights, 1, `${id} deveria ter 1 NIGHT, got ${nights}`);
  }
});

test("tally equilibra ao longo de semanas: quem pegou NIGHT na 1ª pega DAY na 2ª", () => {
  const interns = ["A"];
  const periodTally = tally({ A: { day: 0, night: 0 } });

  // Semana 1: só NIGHT disponível → A leva NIGHT.
  const r1 = allocatePositions({
    positions: [makePos("N1", "2026-04-21", "NIGHT")],
    internIds: interns,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked: empty(interns),
    periodTally,
  });
  assert.equal(r1.matches[0]?.position.period, "NIGHT");
  applyMatchesToPeriodTally(periodTally, r1.matches);
  assert.deepEqual(periodTally.get("A"), { day: 0, night: 1 });

  // Semana 2: DAY e NIGHT disponíveis → A deve preferir DAY (reequilibrar).
  const r2 = allocatePositions({
    positions: [
      makePos("D2", "2026-04-28", "DAY"),
      makePos("N2", "2026-04-28", "NIGHT"),
    ],
    internIds: interns,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked: empty(interns),
    periodTally,
  });
  assert.equal(r2.matches[0]?.position.period, "DAY", "semana 2 deveria compensar com DAY");
});

test("tendência a mais diurnos: interno equilibrado prefere DAY no empate", () => {
  const interns = ["A"];
  const positions: AllocPos[] = [
    makePos("N1", "2026-04-21", "NIGHT"), // NIGHT listado primeiro de propósito
    makePos("D1", "2026-04-21", "DAY"),
  ];

  const { matches } = allocatePositions({
    positions,
    internIds: interns,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked: empty(interns),
    periodTally: tally({ A: { day: 0, night: 0 } }),
  });

  assert.equal(matches[0]?.position.period, "DAY", "empate (0x0) deve preferir DAY");
});

test("CRÍTICO: equidade nunca impede alocação — só sobrou NIGHT, interno leva NIGHT", () => {
  // A prefere DAY pelo tally, mas está bloqueado de todo DAY (CRU). Tem que
  // encaixar no NIGHT mesmo assim — 1 plantão garantido, sem erro.
  const interns = ["A"];
  const positions: AllocPos[] = [
    makePos("D1", "2026-04-21", "DAY"),
    makePos("N1", "2026-04-21", "NIGHT"),
  ];
  const cruBlocked = new Map<string, Set<string>>([
    ["A", new Set(["2026-04-21|DAY"])],
  ]);

  const { matches, unallocatedInterns } = allocatePositions({
    positions,
    internIds: interns,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked,
    periodTally: tally({ A: { day: 0, night: 0 } }),
  });

  assert.equal(unallocatedInterns.length, 0, "A deve ser alocado mesmo sem DAY disponível");
  assert.equal(matches[0]?.position.period, "NIGHT");
});

test("CRÍTICO: só existem vagas NIGHT → todos alocados em NIGHT (cardinalidade máxima)", () => {
  const interns = ["A", "B", "C"];
  const positions: AllocPos[] = [
    makePos("N1", "2026-04-21", "NIGHT"),
    makePos("N2", "2026-04-22", "NIGHT"),
    makePos("N3", "2026-04-23", "NIGHT"),
  ];

  const { matches, unallocatedInterns } = allocatePositions({
    positions,
    internIds: interns,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked: empty(interns),
    periodTally: tally({ A: { day: 0, night: 0 }, B: { day: 0, night: 0 }, C: { day: 0, night: 0 } }),
  });

  assert.equal(matches.length, 3, "todos os 3 devem ser alocados");
  assert.equal(unallocatedInterns.length, 0);
});

test("fairness não reduz cardinalidade: mesmo nº de alocados com e sem tally (cenário com CRU)", () => {
  const interns = ["A", "B", "C", "D"];
  const positions: AllocPos[] = [
    makePos("D1", "2026-04-21", "DAY"),
    makePos("N1", "2026-04-21", "NIGHT"),
    makePos("D2", "2026-04-22", "DAY"),
    makePos("N2", "2026-04-22", "NIGHT"),
  ];
  const cruBlocked = new Map<string, Set<string>>([
    ["A", new Set(["2026-04-22|DAY", "2026-04-22|NIGHT"])],
    ["B", new Set()],
    ["C", new Set(["2026-04-21|DAY"])],
    ["D", new Set()],
  ]);

  const base = {
    positions,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: zeroCounts(interns),
    usedSlots: empty(interns),
    cruBlocked,
  };

  const semTally = allocatePositions({ ...base, internIds: interns });
  const comTally = allocatePositions({
    ...base,
    internIds: interns,
    periodTally: tally({
      A: { day: 0, night: 3 }, B: { day: 2, night: 0 },
      C: { day: 0, night: 1 }, D: { day: 1, night: 1 },
    }),
  });

  assert.equal(
    comTally.matches.length,
    semTally.matches.length,
    `tally não pode reduzir alocações: com=${comTally.matches.length} sem=${semTally.matches.length}`,
  );
  assert.equal(comTally.unallocatedInterns.length, semTally.unallocatedInterns.length);
});

// ── Results ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(55)}`);
console.log(`  PASSED: ${passed}   FAILED: ${failed}   TOTAL: ${passed + failed}`);
console.log(`${"─".repeat(55)}\n`);

if (failed > 0) process.exit(1);
