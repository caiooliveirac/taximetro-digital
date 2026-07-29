import test from "node:test";
import assert from "node:assert/strict";
import {
  validarSemana,
  saldoPorMotivo,
  inicioDaSemana,
  datasDaSemana,
  ehDiaDeAulaFixa,
  MOTIVOS_DECLARAVEIS,
  TETO_TOTAL,
  type Indisponibilidade,
} from "../src/shared/domain/policies/unavailability-policy";

const seg = "2026-07-27"; // segunda
const ter = "2026-07-28";
const qua = "2026-07-29";
const sex = "2026-07-31";

function item(date: string, period: "DAY" | "NIGHT", reason: Indisponibilidade["reason"] = "LIVRE"): Indisponibilidade {
  return { date, period, reason };
}

test("o interno declara 2 turnos livres, e só isso", () => {
  // CRU_SAMU, USA_SAMU e AULA saíram do formulário: o sistema deduz os três.
  assert.deepEqual(MOTIVOS_DECLARAVEIS, ["LIVRE"]);
  assert.equal(TETO_TOTAL, 2);
});

test("semana cheia e válida: 2 turnos livres", () => {
  const semana = [item(seg, "DAY"), item(ter, "NIGHT")];
  assert.deepEqual(validarSemana(semana), { ok: true });
  assert.equal(semana.length, TETO_TOTAL);
});

test("declarar menos que o teto é permitido", () => {
  assert.deepEqual(validarSemana([item(qua, "DAY")]), { ok: true });
  assert.deepEqual(validarSemana([]), { ok: true });
});

test("recusa o terceiro turno", () => {
  const resultado = validarSemana([item(seg, "DAY"), item(ter, "DAY"), item(qua, "DAY")]);
  assert.equal(resultado.ok, false);
  assert.match(resultado.ok === false ? resultado.motivo : "", /máximo 2 turnos/);
});

test("recusa motivo que o sistema passou a deduzir", () => {
  // Se alguém tentar gravar CRU_SAMU por API, o teto zero recusa: aceitar
  // seria deixar o interno bloquear turno à mão sem gastar a cota dele.
  const resultado = validarSemana([item(seg, "DAY", "CRU_SAMU")]);
  assert.equal(resultado.ok, false);
});

test("recusa o mesmo turno declarado duas vezes", () => {
  const resultado = validarSemana([item(seg, "DAY"), item(seg, "DAY")]);
  assert.equal(resultado.ok, false);
  assert.match(resultado.ok === false ? resultado.motivo : "", /declarado duas vezes/);
});

test("mesmo dia em turnos diferentes é válido", () => {
  assert.deepEqual(validarSemana([item(seg, "DAY"), item(seg, "NIGHT")]), { ok: true });
});

test("saldo por motivo reflete o que ainda cabe", () => {
  assert.equal(saldoPorMotivo([item(seg, "DAY")]).LIVRE, 1);
  assert.equal(saldoPorMotivo([item(seg, "DAY"), item(ter, "DAY")]).LIVRE, 0);
});

test("UNIFACS tem aula na segunda, o dia inteiro", () => {
  assert.equal(ehDiaDeAulaFixa("UNIFACS", seg), true);
  assert.equal(ehDiaDeAulaFixa("unifacs", seg), true, "a sigla não pode depender de caixa");
  assert.equal(ehDiaDeAulaFixa("UNIFACS", ter), false);
});

test("faculdade sem dia de aula fixo não bloqueia nada", () => {
  // A regra é por faculdade: ligar para todo mundo tiraria capacidade da grade
  // de quem não tem aula fixa.
  assert.equal(ehDiaDeAulaFixa("EBMSP", seg), false);
  assert.equal(ehDiaDeAulaFixa(null, seg), false);
  assert.equal(ehDiaDeAulaFixa(undefined, seg), false);
});

test("semana começa na segunda, inclusive quando a data é domingo", () => {
  // Domingo é a borda que erra com facilidade: sem tratamento vira a semana seguinte.
  assert.equal(inicioDaSemana("2026-08-02"), "2026-07-27"); // domingo
  assert.equal(inicioDaSemana(seg), seg);
  assert.equal(inicioDaSemana(sex), seg);
});

test("datasDaSemana devolve segunda a domingo", () => {
  const datas = datasDaSemana("2026-07-30");
  assert.equal(datas.length, 7);
  assert.equal(datas[0], seg);
  assert.equal(datas[6], "2026-08-02");
});
