import { strict as assert } from "node:assert";
import test from "node:test";
import { decidirRecadastro } from "../src/features/registration/domain/recadastro";

type Status = "PLANNED" | "ACTIVE" | "CLOSED" | null;
const interno = (cohortStatus: Status) => ({ role: "INTERN", cohortStatus, isActive: true });

test("aluno de turma fechada que roda de novo: conta antiga é arquivada", () => {
  const conta = { roles: [interno("CLOSED")], ultimoPlantaoPendente: null };
  assert.deepEqual(decidirRecadastro(conta), { tipo: "arquivar" });
});

test("líder de turma antiga também começa do zero", () => {
  const conta = { roles: [{ role: "LEADER", cohortStatus: "CLOSED" as const, isActive: true }, interno("CLOSED")], ultimoPlantaoPendente: null };
  assert.deepEqual(decidirRecadastro(conta), { tipo: "arquivar" });
});

test("conta legada sem turma é arquivada", () => {
  assert.deepEqual(decidirRecadastro({ roles: [interno(null)], ultimoPlantaoPendente: null }), { tipo: "arquivar" });
});

test("turma atual colide, mesmo sem plantão pendente", () => {
  assert.deepEqual(decidirRecadastro({ roles: [interno("ACTIVE")], ultimoPlantaoPendente: null }), { tipo: "turma-aberta" });
});

test("quem já se cadastrou na turma do link (planejada) não ganha conta duplicada", () => {
  assert.deepEqual(decidirRecadastro({ roles: [interno("PLANNED")], ultimoPlantaoPendente: null }), { tipo: "turma-aberta" });
});

test("conta sem turma aberta mas com plantão por cumprir não é arquivada", () => {
  const conta = { roles: [interno(null)], ultimoPlantaoPendente: "2026-11-01" };
  assert.deepEqual(decidirRecadastro(conta), { tipo: "plantao-pendente", ate: "2026-11-01" });
});

test("coordenação e preceptoria nunca são arquivadas por convite", () => {
  const coord = { roles: [{ role: "COORDINATOR", cohortStatus: null, isActive: true }], ultimoPlantaoPendente: null };
  const prec = { roles: [{ role: "PRECEPTOR", cohortStatus: null, isActive: true }, interno("CLOSED")], ultimoPlantaoPendente: null };
  assert.deepEqual(decidirRecadastro(coord), { tipo: "conta-de-equipe" });
  assert.deepEqual(decidirRecadastro(prec), { tipo: "conta-de-equipe" });
});
