/**
 * Os filtros de lotação da grade da escala. "Superlotado" é uma peneira só para
 * duas perguntas diferentes — passou da grade, ou passou do que cabe na viatura.
 * "Vaga bloqueada" é o turno no teto físico que ainda tem vaga de grade aberta.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { computeCapacityFlags, splitPeriodSlots } from "../src/features/scheduling/domain/policies/assignment-policy";

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

/**
 * O terceiro interno já sumiu atrás de "+1 item" uma vez. Estes testes travam a
 * regra: pessoa sempre visível, vaga bloqueada nunca vira card na grade.
 */

const person = (id: string) => ({ kind: "assignment", id });
const vacancy = (id: string) => ({ kind: "vacancy", id });
const blocked = (id: string) => ({ kind: "blocked", id });

test("terceiro interno continua visível, nunca vai para o +N", () => {
  const split = splitPeriodSlots([person("a"), person("b"), person("c")], 2);
  assert.equal(split.visible.length, 3);
  assert.equal(split.hidden.length, 0);
});

test("vaga bloqueada não ocupa card na grade, vira contagem", () => {
  const split = splitPeriodSlots([person("a"), person("b"), blocked("z")], 2);
  assert.deepEqual(split.visible.map((slot) => slot.id), ["a", "b"]);
  assert.equal(split.blockedCount, 1);
});

test("vaga livre aparece enquanto sobra espaço", () => {
  const split = splitPeriodSlots([person("a"), vacancy("v")], 2);
  assert.deepEqual(split.visible.map((slot) => slot.id), ["a", "v"]);
  assert.equal(split.hidden.length, 0);
});

test("uma vaga alocável sempre aparece; o resto vai para o +N", () => {
  const split = splitPeriodSlots([person("a"), person("b"), vacancy("v1"), vacancy("v2")], 2);
  assert.deepEqual(split.visible.map((slot) => slot.id), ["a", "b", "v1"]);
  assert.deepEqual(split.hidden.map((slot) => slot.id), ["v2"]);
});

test("a ordem por faculdade da grade é preservada", () => {
  const split = splitPeriodSlots([person("a"), vacancy("v1"), person("b")], 3);
  assert.deepEqual(split.visible.map((slot) => slot.id), ["a", "v1", "b"]);
});
