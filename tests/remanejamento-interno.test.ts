import test from "node:test";
import assert from "node:assert/strict";
import { motivoDoRemanejamento, textoDoRemanejamento, vagasNaGrade } from "../src/lib/remanejamento-interno";
import { computePeriodLoad } from "../src/features/scheduling/domain/policies/assignment-policy";

test("vaga é de grade, não do limite físico", () => {
  assert.equal(vagasNaGrade(computePeriodLoad({ capacity: 2, occupied: 1 })), 1, "duas vagas, um interno");
  assert.equal(vagasNaGrade(computePeriodLoad({ capacity: 1, occupied: 0 })), 1, "uma vaga, ninguém");
  assert.equal(vagasNaGrade(computePeriodLoad({ capacity: 1, occupied: 1 })), 0, "cabe fisicamente, mas a grade está cheia");
  assert.equal(vagasNaGrade(computePeriodLoad({ capacity: 0, occupied: 0 })), 0, "base sem grade hoje não é vaga");
  assert.equal(vagasNaGrade(computePeriodLoad({ capacity: 1, occupied: 2 })), 0, "acima da grade nunca é negativo");
});

test("motivo vem do aviso; sem aviso reconhecido, é a pedido do interno", () => {
  assert.equal(motivoDoRemanejamento("SEM_MEDICO"), "sem médico na base");
  assert.equal(motivoDoRemanejamento(""), "a pedido do interno");
  assert.equal(motivoDoRemanejamento(undefined), "a pedido do interno");
});

test("texto do remanejamento: quem, de onde, para onde, quando, por quê", () => {
  assert.equal(
    textoDoRemanejamento({ interno: "Ana Souza", faculdade: "UNIFACS", de: "BR05", para: "SM01", hora: "19:12", motivo: "sem médico na base" }),
    "🔁 *Ana Souza* (UNIFACS) saiu da BR05 para a SM01 às 19:12: sem médico na base.",
  );
});
