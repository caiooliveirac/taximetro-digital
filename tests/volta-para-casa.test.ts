import test from "node:test";
import assert from "node:assert/strict";
import { internosEmBaseDesativada, mensagemVoltaParaCasa } from "../src/lib/volta-para-casa";

const base = (code: string, desativada: boolean, ocupantes: Array<[string, string]>) => ({
  code,
  name: `Base ${code}`,
  desativada: desativada ? { desde: "08:16", motivo: "SEM ENFERMEIRO" } : null,
  ocupantes: ocupantes.map(([interno, status]) => ({ interno, faculdade: "UFBA", status })),
});

test("só base desativada entra; quem já saiu fica de fora; base vazia some", () => {
  const grupos = internosEmBaseDesativada([
    base("PM04", false, [["Ana", "CHECKED_IN"]]),
    base("PM40", true, [["Zeca", "SCHEDULED"], ["Bia", "CHECKED_IN"], ["Cris", "CHECKED_OUT"]]),
    base("BR05", true, []),
  ]);
  assert.deepEqual(grupos.map((g) => g.baseCode), ["PM40"]);
  assert.deepEqual(grupos[0].internos.map((i) => i.interno), ["Bia", "Zeca"]);
});

test("mensagem escapa HTML e traz base, faculdade e total", () => {
  const msg = mensagemVoltaParaCasa(internosEmBaseDesativada([base("PM40", true, [["A <b>", "CHECKED_IN"]])]), "2026-10-09");
  assert.match(msg, /Voltam para casa · 09\/10/);
  assert.match(msg, /1 interno\(s\)/);
  assert.match(msg, /A &lt;b&gt; \(UFBA\)/);
});

import { celulaOcupavel, celulasDaBase } from "../src/lib/remanejamento-interno";

test("extra sem check-in segura o lugar físico e não vira vaga depois da tolerância", () => {
  // Grade de 1 (Débora, presente), limite físico 2, Karol extra sem check-in.
  const celulas = celulasDaBase(
    1,
    [
      { faculdade: "UNIFACS", status: "CHECKED_IN" },
      { faculdade: "ZARNS", status: "SCHEDULED", extra: true },
    ],
    { reivindicarSemCheckin: true, extra: { limite: 2, podeUsar: true, reservadaPara: null } },
  );
  assert.equal(celulas.some(celulaOcupavel), false);
});

test("sem o extra, o segundo lugar físico continua ocupável", () => {
  const celulas = celulasDaBase(1, [{ faculdade: "UNIFACS", status: "CHECKED_IN" }], {
    reivindicarSemCheckin: true,
    extra: { limite: 2, podeUsar: true, reservadaPara: null },
  });
  assert.equal(celulas.some(celulaOcupavel), true);
});
