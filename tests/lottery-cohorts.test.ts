import { strict as assert } from "node:assert";
import test from "node:test";
import {
  internosDaTurma,
  SEM_TURMA,
  TODAS_AS_TURMAS,
  turmaPadraoDoSorteio,
  turmasDoSorteio,
} from "../src/features/scheduling/domain/policies/lottery-cohorts";

// Faculdade com duas turmas em datas seguidas + um interno sem turma.
// É o que o COORDINATOR vê ao entrar por impersonate de líder sem turma.
const INTERNS = [
  { id: "a1", name: "Ana Antiga", roleActive: true, cohortId: "antiga", cohortName: "Turma 2", cohortStart: "2026-06-29", cohortEnd: "2026-08-09" },
  { id: "a2", name: "Bia Antiga", roleActive: false, cohortId: "antiga", cohortName: "Turma 2", cohortStart: "2026-06-29", cohortEnd: "2026-08-09" },
  { id: "n1", name: "Caio Nova", roleActive: true, cohortId: "nova", cohortName: null, cohortLabel: "Turma 3 (EBMSP)", cohortStart: "2026-08-10", cohortEnd: "2026-09-20" },
  { id: "n2", name: "Duda Nova", roleActive: true, cohortId: "nova", cohortName: null, cohortLabel: "Turma 3 (EBMSP)", cohortStart: "2026-08-10", cohortEnd: "2026-09-20" },
  { id: "s1", name: "Edu Sem Turma", roleActive: true, cohortId: null, cohortName: null, cohortStart: null, cohortEnd: null },
];

test("agrupa por turma, mais recente primeiro e sem turma por último", () => {
  const turmas = turmasDoSorteio(INTERNS);
  assert.deepEqual(turmas.map((t) => t.key), ["nova", "antiga", SEM_TURMA]);
  // apelido ausente cai no nome cheio da turma
  assert.equal(turmas[0].label, "Turma 3 (EBMSP)");
  assert.equal(turmas[1].label, "Turma 2");
  // inativo conta no total mas não nos ativos (só ativos são sorteados)
  assert.deepEqual({ ativos: turmas[1].ativos, total: turmas[1].total }, { ativos: 1, total: 2 });
});

test("turma padrão é a que cruza a semana sorteada", () => {
  const turmas = turmasDoSorteio(INTERNS);
  // semana de 03/08 a 09/08: só a antiga alcança
  assert.equal(turmaPadraoDoSorteio(turmas, "2026-08-03"), "antiga");
  // semana de 17/08 a 23/08: só a nova
  assert.equal(turmaPadraoDoSorteio(turmas, "2026-08-17"), "nova");
});

test("semana de virada fica com a turma que começou depois", () => {
  const turmas = turmasDoSorteio(INTERNS);
  // 10/08 é segunda: a antiga terminou no domingo 09/08 e não cruza mais
  assert.equal(turmaPadraoDoSorteio(turmas, "2026-08-10"), "nova");
  // 06/07: só a antiga; empate real é quando as duas pegam a mesma semana
  const sobrepostas = turmasDoSorteio([
    ...INTERNS,
    { id: "n3", name: "Fê Nova Antecipada", roleActive: true, cohortId: "antecipada", cohortName: "Turma 2.5", cohortStart: "2026-08-05", cohortEnd: "2026-09-01" },
  ]);
  assert.equal(turmaPadraoDoSorteio(sobrepostas, "2026-08-03"), "antecipada");
});

test("sem turma cruzando a semana ninguém é escondido", () => {
  const turmas = turmasDoSorteio(INTERNS);
  assert.equal(turmaPadraoDoSorteio(turmas, "2026-12-28"), TODAS_AS_TURMAS);

  // faculdade que nunca cadastrou turma: o sorteio segue como era antes
  const semTurmaAlguma = turmasDoSorteio([INTERNS[4]]);
  assert.deepEqual(semTurmaAlguma.map((t) => t.key), [SEM_TURMA]);
  assert.equal(turmaPadraoDoSorteio(semTurmaAlguma, "2026-08-10"), TODAS_AS_TURMAS);
});

test("turma só de inativos não é pré-selecionada", () => {
  const turmas = turmasDoSorteio([
    { id: "x", name: "Só Inativo", roleActive: false, cohortId: "vazia", cohortName: "Turma X", cohortStart: "2026-08-10", cohortEnd: "2026-09-20" },
  ]);
  assert.equal(turmaPadraoDoSorteio(turmas, "2026-08-10"), TODAS_AS_TURMAS);
});

test("internosDaTurma recorta a lista e TODAS devolve tudo", () => {
  assert.deepEqual(internosDaTurma(INTERNS, "nova").map((i) => i.id), ["n1", "n2"]);
  assert.deepEqual(internosDaTurma(INTERNS, SEM_TURMA).map((i) => i.id), ["s1"]);
  assert.equal(internosDaTurma(INTERNS, TODAS_AS_TURMAS).length, INTERNS.length);
});
