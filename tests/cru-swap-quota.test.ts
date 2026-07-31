import test from "node:test";
import assert from "node:assert/strict";
import { hasUsedCruSwapQuota, resolveCruSwapWindow } from "../src/shared/domain/policies/cru-swap-quota-policy";

const TODAY = "2026-07-30";
const RODIZIO = { from: "2026-07-06", to: "2026-08-16" };

test("janela do rodízio vale quando hoje está dentro dela", () => {
  assert.deepEqual(resolveCruSwapWindow({ today: TODAY, rotation: RODIZIO }), RODIZIO);
});

test("rodízio vencido cai no fallback de 6 semanas", () => {
  const window = resolveCruSwapWindow({ today: TODAY, rotation: { from: "2026-05-01", to: "2026-06-14" } });
  assert.equal(window.from, "2026-06-19");
});

test("interno sem CRU fixo usa fallback aberto para frente", () => {
  const window = resolveCruSwapWindow({ today: TODAY, rotation: null });
  assert.equal(window.from, "2026-06-19");
  assert.equal(
    hasUsedCruSwapQuota({ window, swapDates: ["2026-08-20"] }),
    true,
    "troca marcada para o futuro tem que contar",
  );
});

test("uma troca dentro do rodízio esgota a cota", () => {
  assert.equal(hasUsedCruSwapQuota({ window: RODIZIO, swapDates: ["2026-07-20"] }), true);
});

test("troca do rodízio anterior não bloqueia o atual", () => {
  assert.equal(hasUsedCruSwapQuota({ window: RODIZIO, swapDates: ["2026-06-15"] }), false);
});

test("repetente em rodízio novo começa com cota cheia", () => {
  // trocou em 20/07, dentro do rodízio antigo; turma nova começa em 03/08
  const novoRodizio = { from: "2026-08-03", to: "2026-09-13" };
  assert.equal(hasUsedCruSwapQuota({ window: novoRodizio, swapDates: ["2026-07-20"] }), false);
});

test("sem troca nenhuma a cota está livre", () => {
  assert.equal(hasUsedCruSwapQuota({ window: RODIZIO, swapDates: [] }), false);
});
