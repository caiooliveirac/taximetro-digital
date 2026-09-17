import test from "node:test";
import assert from "node:assert/strict";
import { turnosColados, type AllocPos } from "../src/features/scheduling/application/use-cases/allocate-positions";
import { sortearHorizonte } from "../src/features/scheduling/application/use-cases/lottery-horizon";

const BASES = ["B1", "B2", "B3", "B4"];
const qualidade = (code: string) => (BASES.length - BASES.indexOf(code)) / BASES.length;
const dia = (n: number) => new Date(Date.UTC(2026, 8, 21 + n, 12)).toISOString().slice(0, 10);

/** 4 semanas; por semana 2 diurnos (B1, B2) e 2 noturnos (B3, B4), em dias espaçados. */
function semanas(): AllocPos[][] {
  return Array.from({ length: 4 }, (_, w) => [
    { baseId: "B1", baseCode: "B1", baseType: "USA", date: dia(7 * w), period: "DAY" as const, shift: null },
    { baseId: "B2", baseCode: "B2", baseType: "USA", date: dia(7 * w + 2), period: "DAY" as const, shift: null },
    { baseId: "B3", baseCode: "B3", baseType: "USA", date: dia(7 * w + 4), period: "NIGHT" as const, shift: null },
    { baseId: "B4", baseCode: "B4", baseType: "USA", date: dia(7 * w + 6), period: "NIGHT" as const, shift: null },
  ]);
}

function sortear(overrides: Partial<Parameters<typeof sortearHorizonte>[0]> = {}) {
  const internIds = ["A", "B", "C", "D"];
  return sortearHorizonte({
    positionsByWeek: semanas(),
    internIds,
    maxShifts: 1,
    isEbmsp: false,
    existingUsaShiftCountByWeek: semanas().map(() => new Map(internIds.map((id) => [id, 0]))),
    usedSlots: new Map(internIds.map((id) => [id, new Set<string>()])),
    cruBlocked: new Map(),
    qualidade,
    seed: 42,
    ...overrides,
  });
}

test("lote inteiro: noturnos, qualidade e bases saem iguais para todos", () => {
  const { matches, justica } = sortear();
  assert.equal(matches.length, 16);
  assert.deepEqual(justica.plantoes, { min: 4, max: 4 });
  assert.deepEqual(justica.noturnos, { min: 2, max: 2 });
  assert.deepEqual(justica.noturnosIdeal, { min: 2, max: 2 });
  assert.equal(justica.basesRepetidas, 0);
  assert.equal(justica.qualidadeMedia!.min, justica.qualidadeMedia!.max);
});

test("mesma semente, mesmo sorteio", () => {
  const chave = (r: ReturnType<typeof sortear>) =>
    r.matches.map((m) => `${m.internId}@${m.position.date}${m.position.period}`).sort().join();
  assert.equal(chave(sortear()), chave(sortear()));
});

test("bloqueio de CRU e descanso de 12h valem também nas trocas entre semanas", () => {
  // A tem CRU toda quinta-feira de dia (dia 3 de cada semana): não pode a noite
  // de quarta nem a de quinta. B3 cai na sexta (dia 4) à noite — livre; mas
  // bloqueamos também as noites de B3 para A e conferimos que nunca caem nele.
  const bloqueadas = new Set<string>();
  for (let w = 0; w < 4; w++) bloqueadas.add(`${dia(7 * w + 4)}|NIGHT`);
  const { matches } = sortear({ cruBlocked: new Map([["A", bloqueadas]]) });

  assert.equal(matches.length, 16);
  for (const m of matches.filter((x) => x.internId === "A")) {
    assert.ok(!bloqueadas.has(`${m.position.date}|${m.position.period}`), "A caiu em turno bloqueado");
  }
  for (const id of ["A", "B", "C", "D"]) {
    const meus = new Set(matches.filter((m) => m.internId === id).map((m) => `${m.position.date}|${m.position.period}`));
    for (const m of matches.filter((x) => x.internId === id)) {
      assert.ok(!turnosColados(m.position).some((k) => meus.has(k)), `${id} com 24h seguidas`);
    }
  }
});

test("quem sobra numa semana não sobra de novo: plantões diferem no máximo 1", () => {
  const internIds = ["A", "B", "C", "D", "E"]; // 5 internos, 4 vagas por semana
  const { justica } = sortear({
    internIds,
    existingUsaShiftCountByWeek: semanas().map(() => new Map(internIds.map((id) => [id, 0]))),
    usedSlots: new Map(internIds.map((id) => [id, new Set<string>()])),
  });
  assert.ok(justica.plantoes.max - justica.plantoes.min <= 1, JSON.stringify(justica.plantoes));
});
