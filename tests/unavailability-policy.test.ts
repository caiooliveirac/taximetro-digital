import test from "node:test";
import assert from "node:assert/strict";
import {
  validarSemana,
  saldoPorMotivo,
  inicioDaSemana,
  datasDaSemana,
  TETO_TOTAL,
  type Indisponibilidade,
} from "../src/shared/domain/policies/unavailability-policy";

const seg = "2026-07-27"; // segunda
const ter = "2026-07-28";
const qua = "2026-07-29";
const qui = "2026-07-30";
const sex = "2026-07-31";

function item(date: string, period: "DAY" | "NIGHT", reason: Indisponibilidade["reason"]): Indisponibilidade {
  return { date, period, reason };
}

test("semana cheia e válida: 1 CRU + 1 USA + 2 AULA", () => {
  const semana = [
    item(seg, "DAY", "CRU_SAMU"),
    item(ter, "NIGHT", "USA_SAMU"),
    item(qua, "DAY", "AULA"),
    item(qui, "DAY", "AULA"),
  ];
  assert.deepEqual(validarSemana(semana), { ok: true });
  assert.equal(semana.length, TETO_TOTAL);
});

test("declarar menos que o teto é permitido", () => {
  // Quem só tem aula numa tarde marca uma e pronto — não é obrigatório encher.
  assert.deepEqual(validarSemana([item(qua, "DAY", "AULA")]), { ok: true });
  assert.deepEqual(validarSemana([]), { ok: true });
});

test("recusa 2 turnos de CRU SAMU", () => {
  const resultado = validarSemana([
    item(seg, "DAY", "CRU_SAMU"),
    item(ter, "DAY", "CRU_SAMU"),
  ]);
  assert.equal(resultado.ok, false);
  assert.match(resultado.ok === false ? resultado.motivo : "", /1 turno por CRU SAMU/);
});

test("recusa 2 turnos de USA SAMU", () => {
  const resultado = validarSemana([
    item(seg, "DAY", "USA_SAMU"),
    item(ter, "NIGHT", "USA_SAMU"),
  ]);
  assert.equal(resultado.ok, false);
  assert.match(resultado.ok === false ? resultado.motivo : "", /1 turno por USA SAMU/);
});

test("recusa 3 aulas", () => {
  const resultado = validarSemana([
    item(seg, "DAY", "AULA"),
    item(ter, "DAY", "AULA"),
    item(qua, "DAY", "AULA"),
  ]);
  assert.equal(resultado.ok, false);
  assert.match(resultado.ok === false ? resultado.motivo : "", /máximo 2 turnos por Aula/);
});

test("recusa mais de 4 no total mesmo com motivos válidos", () => {
  const resultado = validarSemana([
    item(seg, "DAY", "CRU_SAMU"),
    item(ter, "DAY", "USA_SAMU"),
    item(qua, "DAY", "AULA"),
    item(qui, "DAY", "AULA"),
    item(sex, "DAY", "AULA"),
  ]);
  assert.equal(resultado.ok, false);
  assert.match(resultado.ok === false ? resultado.motivo : "", /máximo 4 turnos/);
});

test("recusa o mesmo turno declarado duas vezes", () => {
  // Sem isto, o interno poderia gastar dois motivos no mesmo slot e o sorteio
  // veria um bloqueio só — o teto viraria ficção.
  const resultado = validarSemana([
    item(seg, "DAY", "CRU_SAMU"),
    item(seg, "DAY", "AULA"),
  ]);
  assert.equal(resultado.ok, false);
  assert.match(resultado.ok === false ? resultado.motivo : "", /declarado duas vezes/);
});

test("mesmo dia em turnos diferentes é válido", () => {
  assert.deepEqual(
    validarSemana([item(seg, "DAY", "CRU_SAMU"), item(seg, "NIGHT", "USA_SAMU")]),
    { ok: true },
  );
});

test("saldo por motivo reflete o que ainda cabe", () => {
  const saldo = saldoPorMotivo([item(seg, "DAY", "CRU_SAMU"), item(ter, "DAY", "AULA")]);
  assert.deepEqual(saldo, { CRU_SAMU: 0, USA_SAMU: 1, AULA: 1 });
});

test("semana começa na segunda, inclusive quando a data é domingo", () => {
  // Domingo é a borda que erra com facilidade: sem tratamento vira a semana seguinte.
  assert.equal(inicioDaSemana("2026-08-02"), "2026-07-27"); // domingo
  assert.equal(inicioDaSemana(seg), seg);
  assert.equal(inicioDaSemana(sex), seg);
});

test("datasDaSemana devolve segunda a domingo", () => {
  const datas = datasDaSemana(qui);
  assert.equal(datas.length, 7);
  assert.equal(datas[0], seg);
  assert.equal(datas[6], "2026-08-02");
});
