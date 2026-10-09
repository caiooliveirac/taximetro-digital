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
