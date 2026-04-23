import assert from "node:assert/strict";
import test from "node:test";

import { computeCruFixedWeeksWindow } from "../src/features/scheduling/application/use-cases/cru-fixed-weeks-window";

test("computeCruFixedWeeksWindow: usa janela semanal fechada (semana atual + N-1)", () => {
  const result = computeCruFixedWeeksWindow({
    today: "2026-04-20", // segunda-feira
    weeks: 1,
  });

  assert.equal(result.startDate, "2026-04-20");
  assert.equal(result.weekStart, "2026-04-20");
  assert.equal(result.validUntil, "2026-04-26"); // domingo da semana atual
});

test("computeCruFixedWeeksWindow: não extrapola para uma semana extra em limite de dia", () => {
  const result = computeCruFixedWeeksWindow({
    today: "2026-04-20", // segunda-feira
    weeks: 6,
  });

  // 6 semanas exatas: semana de 20/04 até domingo 31/05
  assert.equal(result.validUntil, "2026-05-31");
});

test("computeCruFixedWeeksWindow: respeita semana atual mesmo no meio da semana", () => {
  const result = computeCruFixedWeeksWindow({
    today: "2026-04-23", // quinta-feira
    weeks: 3,
  });

  assert.equal(result.startDate, "2026-04-23");
  assert.equal(result.weekStart, "2026-04-20");
  assert.equal(result.validUntil, "2026-05-10"); // domingo da 3a semana
});
