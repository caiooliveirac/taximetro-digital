import { strict as assert } from "node:assert";
import test from "node:test";
import { decidirRecadastro } from "../src/features/registration/domain/recadastro";

const turmaNova = "unifacs6";
const interno = (cohortId: string | null) => ({ role: "INTERN", cohortId, isActive: true });

test("aluno de turma fechada que roda de novo: conta antiga é arquivada", () => {
  const conta = { roles: [interno("unifacs4")], ultimoPlantaoPendente: null };
  assert.deepEqual(decidirRecadastro(conta, turmaNova), { tipo: "arquivar" });
});

test("líder de turma antiga também começa do zero", () => {
  const conta = { roles: [{ role: "LEADER", cohortId: "unifacs2", isActive: true }, interno("unifacs2")], ultimoPlantaoPendente: null };
  assert.deepEqual(decidirRecadastro(conta, turmaNova), { tipo: "arquivar" });
});

test("conta legada sem turma é arquivada", () => {
  assert.deepEqual(decidirRecadastro({ roles: [interno(null)], ultimoPlantaoPendente: null }, turmaNova), { tipo: "arquivar" });
});

test("quem já se cadastrou na turma do link não ganha conta duplicada", () => {
  const conta = { roles: [interno(turmaNova)], ultimoPlantaoPendente: null };
  assert.deepEqual(decidirRecadastro(conta, turmaNova), { tipo: "ja-na-turma" });
});

test("conta com plantão por cumprir não é arquivada", () => {
  const conta = { roles: [interno("unifacs5")], ultimoPlantaoPendente: "2026-11-01" };
  assert.deepEqual(decidirRecadastro(conta, turmaNova), { tipo: "plantao-pendente", ate: "2026-11-01" });
});

test("coordenação e preceptoria nunca são arquivadas por convite", () => {
  const coord = { roles: [{ role: "COORDINATOR", cohortId: null, isActive: true }], ultimoPlantaoPendente: null };
  const prec = { roles: [{ role: "PRECEPTOR", cohortId: null, isActive: true }, interno("unifacs1")], ultimoPlantaoPendente: null };
  assert.deepEqual(decidirRecadastro(coord, turmaNova), { tipo: "conta-de-equipe" });
  assert.deepEqual(decidirRecadastro(prec, turmaNova), { tipo: "conta-de-equipe" });
});
