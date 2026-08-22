/**
 * Os filtros de lotação da grade da escala. "Superlotado" é uma peneira só para
 * duas perguntas diferentes — passou da grade, ou passou do que cabe na viatura.
 * "Vaga bloqueada" é o turno no teto físico que ainda tem vaga de grade aberta.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { computeCapacityFlags } from "../src/features/scheduling/domain/policies/assignment-policy";

test("2 internos numa vaga só é superlotado", () => {
  const flags = computeCapacityFlags({ capacity: 1, occupied: 2, openRuleSlots: 0 });
  assert.equal(flags.overloaded, true);
});

test("3 internos onde cabem 2 também é superlotado", () => {
  const flags = computeCapacityFlags({ capacity: 2, occupied: 3, openRuleSlots: 0 });
  assert.equal(flags.overloaded, true);
});

test("turno na medida não é superlotado", () => {
  const flags = computeCapacityFlags({ capacity: 2, occupied: 2, openRuleSlots: 0 });
  assert.equal(flags.overloaded, false);
});

test("turno no teto com vaga de grade aberta tem vaga bloqueada", () => {
  // Caso real: grade abre 1 UNIFACS + 1 ZARNS, dois internos UNIFACS ocupam a
  // viatura. A vaga ZARNS continua na grade, mas não cabe mais ninguém.
  const flags = computeCapacityFlags({ capacity: 2, occupied: 2, openRuleSlots: 1 });
  assert.equal(flags.blocked, true);
});

test("grade acima do teto físico não bloqueia enquanto a viatura não enche", () => {
  const flags = computeCapacityFlags({ capacity: 3, occupied: 2, openRuleSlots: 1 });
  assert.equal(flags.blocked, false);
});

test("turno no teto sem vaga sobrando não tem vaga bloqueada", () => {
  const flags = computeCapacityFlags({ capacity: 2, occupied: 2, openRuleSlots: 0 });
  assert.equal(flags.blocked, false);
});

test("turno com folga não bloqueia vaga nenhuma", () => {
  const flags = computeCapacityFlags({ capacity: 2, occupied: 1, openRuleSlots: 1 });
  assert.equal(flags.blocked, false);
});

test("CRU e CRL (sem teto) não entram em nenhum dos dois filtros", () => {
  const flags = computeCapacityFlags({ capacity: 0, occupied: 12, openRuleSlots: 0 });
  assert.equal(flags.overloaded, false);
  assert.equal(flags.blocked, false);
});
