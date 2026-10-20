import test from "node:test";
import assert from "node:assert/strict";
import { allocatePositions, type AllocPos } from "../src/features/scheduling/application/use-cases/allocate-positions";
import { buildWeekPositions, shouldIncludeRuleInLottery } from "../src/features/scheduling/application/use-cases/run-leader-lottery";
import { buildUnallocatedDiagnostics } from "../src/features/scheduling/application/use-cases/lottery-diagnostics";
import { sorteiaCruDiurna, usaMeioTurnoNaCru } from "../src/lib/utils";
import { readFileSync } from "node:fs";
import path from "node:path";

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

// STAX-18: desligar o meio turno da EBMSP (2026-09-22) tirou a CRU diurna dela do
// sorteio, porque as duas decisões passavam pela mesma chave. A intenção era só
// o plantão sair de 12h (`shift = null`).
const semanaCru = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
const regrasCru = [
  { baseId: "cru", baseCode: "CRU", baseType: "CENTRAL", dayOfWeek: "MON", period: "DAY", capacity: 3 },
  { baseId: "cru", baseCode: "CRU", baseType: "CENTRAL", dayOfWeek: "MON", period: "NIGHT", capacity: 2 },
  { baseId: "sm01", baseCode: "SM01", baseType: "USA", dayOfWeek: "MON", period: "DAY", capacity: 1 },
];

function vagasDaFaculdade(abbr: string) {
  return buildWeekPositions({
    rules: regrasCru,
    weekExisting: [],
    weekDates: semanaCru,
    sorteiaCru: sorteiaCruDiurna(abbr),
    meioTurno: usaMeioTurnoNaCru(abbr),
  });
}

test("STAX-18: EBMSP sorteia a CRU diurna de 12h com o meio turno desligado", () => {
  assert.equal(usaMeioTurnoNaCru("EBMSP"), false, "meio turno segue desligado");
  assert.equal(sorteiaCruDiurna("EBMSP"), true);

  const cru = vagasDaFaculdade("EBMSP").filter((p) => p.baseType === "CENTRAL");
  assert.equal(cru.length, 3, "as 3 vagas CRU/DAY entram (a CRU noturna, não)");
  assert.ok(cru.every((p) => p.period === "DAY" && p.shift === null), "plantão inteiro, shift = null");
});

test("STAX-18: as outras faculdades continuam sorteando só USA", () => {
  assert.equal(sorteiaCruDiurna("ZARNS"), false);
  const vagas = vagasDaFaculdade("ZARNS");
  assert.deepEqual(vagas.map((p) => p.baseCode), ["SM01"]);
});

test("STAX-18: sorteio e liberação de vaga decidem a CRU por sorteiaCruDiurna, não pelo meio turno", () => {
  const ler = (f: string) => readFileSync(path.join(process.cwd(), "src/features/scheduling/application/use-cases", f), "utf8");
  const sorteio = ler("run-leader-lottery.ts");
  assert.match(sorteio, /const sorteiaCru = sorteiaCruDiurna\(facultyAbbreviation\)/);
  assert.match(sorteio, /shouldIncludeRuleInLottery\(row, sorteiaCru\)/);
  const liberacao = ler("release-slots.ts");
  assert.match(liberacao, /const sorteiaCru = sorteiaCruDiurna\(abbr\)/);
  assert.match(liberacao, /shouldIncludeRuleInLottery\(rule, sorteiaCru\)/);
});

function cru(date: string, shift: string | null): AllocPos {
  return { baseId: "cru", baseCode: "CRU", baseType: "CENTRAL", date, period: "DAY", shift };
}

function sortearCru(alvo: AllocPos, ocupado: string) {
  return allocatePositions({
    positions: [alvo],
    internIds: ["intern-a"],
    maxShifts: 1,
    isEbmsp: Boolean(alvo.shift),
    existingUsaShiftCount: new Map([["intern-a", 0]]),
    usedSlots: new Map([["intern-a", new Set([ocupado])]]),
    cruBlocked: new Map([["intern-a", new Set<string>()]]),
  });
}

test("CRU sorteada de 12h respeita o descanso: noturno na véspera barra o diurno seguinte", () => {
  assert.equal(sortearCru(cru("2026-10-20", null), "2026-10-19|NIGHT").matches.length, 0);
  assert.equal(sortearCru(cru("2026-10-20", null), "2026-10-20|NIGHT").matches.length, 0);
  assert.equal(sortearCru(cru("2026-10-20", null), "2026-10-18|NIGHT").matches.length, 1);
});

test("meio turno da CRU (6h) segue fora da conta de descanso", () => {
  assert.equal(sortearCru(cru("2026-10-20", "MORNING"), "2026-10-19|NIGHT").matches.length, 1);
});
