import { test } from "node:test";
import assert from "node:assert/strict";
import { computePeriodLoad } from "../src/features/scheduling/domain/policies/assignment-policy";

test("dois internos numa vaga só: avisa, não trava", () => {
  const load = computePeriodLoad({ capacity: 1, occupied: 2 });
  assert.equal(load.aboveGrade, true);
  assert.equal(load.overcrowded, false);
  assert.equal(load.full, true, "cheio no limite físico — a vaga que sobra fica bloqueada");
  assert.equal(load.limit, 2);
});

test("um interno numa vaga só: nada a avisar", () => {
  const load = computePeriodLoad({ capacity: 1, occupied: 1 });
  assert.equal(load.aboveGrade, false);
  assert.equal(load.full, false);
});

test("duas vagas com dois internos: cheio, sem aviso de grade", () => {
  const load = computePeriodLoad({ capacity: 2, occupied: 2 });
  assert.equal(load.aboveGrade, false);
  assert.equal(load.full, true);
  assert.equal(load.overcrowded, false);
});

test("três internos onde cabem dois é excesso", () => {
  const load = computePeriodLoad({ capacity: 2, occupied: 3 });
  assert.equal(load.overcrowded, true);
  assert.equal(load.full, true);
});

test("três internos numa vaga só também é excesso", () => {
  const load = computePeriodLoad({ capacity: 1, occupied: 3 });
  assert.equal(load.aboveGrade, true);
  assert.equal(load.overcrowded, true);
});

// Base USA com três vagas na grade não é o normal, mas se alguém montar assim
// a grade manda — o teto físico é piso, não teto do teto.
test("grade maior que o limite físico manda", () => {
  assert.equal(computePeriodLoad({ capacity: 3, occupied: 3 }).full, true);
  assert.equal(computePeriodLoad({ capacity: 3, occupied: 2 }).full, false);
  assert.equal(computePeriodLoad({ capacity: 3, occupied: 4 }).overcrowded, true);
});

// capacity 0 é como CRU/CRL e base sem grade entram aqui: sem teto, sem alerta.
test("sem grade no turno não tem teto a aplicar", () => {
  const load = computePeriodLoad({ capacity: 0, occupied: 2 });
  assert.equal(load.full, false);
  assert.equal(load.overcrowded, false);
  assert.equal(load.aboveGrade, false);
});
