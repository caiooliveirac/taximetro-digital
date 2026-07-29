import test from "node:test";
import assert from "node:assert/strict";
import { allocatePositions, type AllocPos } from "../src/features/scheduling/application/use-cases/allocate-positions";

const SEG = "2026-07-27";
const TER = "2026-07-28";

function posicao(date: string, period: "DAY" | "NIGHT", baseCode = "SM01"): AllocPos {
  return { baseId: `base-${baseCode}`, baseCode, baseType: "USA", date, period, shift: null };
}

function entrada(over: Partial<Parameters<typeof allocatePositions>[0]> = {}) {
  const internIds = over.internIds ?? ["interno-a"];
  return {
    positions: [posicao(SEG, "DAY")],
    internIds,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCount: new Map(internIds.map((id) => [id, 0])),
    usedSlots: new Map(internIds.map((id) => [id, new Set<string>()])),
    cruBlocked: new Map(internIds.map((id) => [id, new Set<string>()])),
    ...over,
  };
}

test("sem indisponibilidade, o interno é alocado normalmente", () => {
  const resultado = allocatePositions(entrada());
  assert.equal(resultado.matches.length, 1);
  assert.equal(resultado.matches[0].internId, "interno-a");
});

test("interno indisponível naquele turno não é alocado", () => {
  const resultado = allocatePositions(
    entrada({ unavailable: new Map([["interno-a", new Set([`${SEG}|DAY`])]]) }),
  );
  assert.equal(resultado.matches.length, 0);
  assert.deepEqual(resultado.unallocatedInterns, ["interno-a"]);
  assert.equal(resultado.remainingPositions, 1);
});

test("a indisponibilidade vale só para o turno declarado", () => {
  // Bloqueou o dia de segunda; a vaga da noite de segunda continua valendo.
  const resultado = allocatePositions(
    entrada({
      positions: [posicao(SEG, "NIGHT")],
      unavailable: new Map([["interno-a", new Set([`${SEG}|DAY`])]]),
    }),
  );
  assert.equal(resultado.matches.length, 1);
});

test("a vaga bloqueada para um interno vai para outro que está livre", () => {
  // É o caso que importa na prática: o sorteio não pode desperdiçar a vaga só
  // porque o primeiro sorteado avisou que não podia.
  const resultado = allocatePositions(
    entrada({
      internIds: ["interno-a", "interno-b"],
      unavailable: new Map([["interno-a", new Set([`${SEG}|DAY`])]]),
    }),
  );
  assert.equal(resultado.matches.length, 1);
  assert.equal(resultado.matches[0].internId, "interno-b");
});

test("indisponibilidade bloqueia mesmo em base que não é USA", () => {
  // Diferente da regra de CRU ±12h, que só vale para alvo USA: aqui o interno
  // disse que não pode naquele turno, e isso vale para qualquer base.
  const central: AllocPos = {
    baseId: "base-CRU", baseCode: "CRU", baseType: "CENTRAL",
    date: TER, period: "DAY", shift: null,
  };
  const resultado = allocatePositions(
    entrada({
      positions: [central],
      unavailable: new Map([["interno-a", new Set([`${TER}|DAY`])]]),
    }),
  );
  assert.equal(resultado.matches.length, 0);
});
