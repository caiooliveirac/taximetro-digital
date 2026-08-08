import { test } from "node:test";
import assert from "node:assert/strict";
import { computePeriodLoad } from "../src/features/scheduling/domain/policies/assignment-policy";

test("duas vagas com dois internos: cheio, sem excesso", () => {
  const load = computePeriodLoad({ capacity: 2, occupied: 2 });
  assert.equal(load.full, true);
  assert.equal(load.overcrowded, false);
});

test("três internos em base de duas vagas é excesso", () => {
  const load = computePeriodLoad({ capacity: 2, occupied: 3 });
  assert.equal(load.full, true);
  assert.equal(load.overcrowded, true);
});

test("vaga sobrando ainda dá para alocar", () => {
  const load = computePeriodLoad({ capacity: 2, occupied: 1 });
  assert.equal(load.full, false);
  assert.equal(load.overcrowded, false);
});

test("base sem grade no turno não tem teto a aplicar", () => {
  const load = computePeriodLoad({ capacity: 0, occupied: 2 });
  assert.equal(load.full, false);
  assert.equal(load.overcrowded, false);
});
