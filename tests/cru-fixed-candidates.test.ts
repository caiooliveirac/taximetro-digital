import { strict as assert } from "node:assert";
import test from "node:test";
import { filterCruFixedCandidates } from "../src/features/scheduling/domain/policies/cru-fixed-candidates";

// Semana corrente começa 03/08 (hoje 08/08, sábado); rodízio de 6 semanas vai até
// 13/09. A turma precisa alcançar o fim da janela — ou ao menos a próxima segunda.
const JANELA = { mustReach: "2026-08-10", windowEnd: "2026-09-13" };

const INTERNS = [
  { id: "atual", name: "Ana Turma Atual", cohortStart: "2026-08-10", cohortEnd: "2026-09-20" },
  // turma que acaba no domingo desta semana: ainda cruza a janela do servidor,
  // mas não serve para um rodízio das semanas por vir
  { id: "antiga", name: "Beto Turma Antiga", cohortStart: "2026-06-29", cohortEnd: "2026-08-09" },
  { id: "semturma", name: "Caio Sem Turma", cohortStart: null, cohortEnd: null },
  { id: "comfixo", name: "Duda Já Fixa", cohortStart: "2026-08-10", cohortEnd: "2026-09-20" },
];

const FIXOS = [
  { intern_id: "comfixo", day_of_week: "THU", period: "DAY" },
];

function run(search = "") {
  return filterCruFixedCandidates({
    interns: INTERNS,
    cruFixed: FIXOS,
    dayOfWeek: "FRI",
    period: "DAY",
    ...JANELA,
    search,
  });
}

test("lista padrão: só turma da janela e sem fixo", () => {
  const { list, hiddenWithFixed, hiddenOtherCohort } = run();
  assert.deepEqual(list.map((i) => i.id), ["atual", "semturma"]);
  assert.equal(hiddenOtherCohort, 1); // turma que acabou em 09/08
  assert.equal(hiddenWithFixed, 1);   // já tem fixo na quinta
});

test("busca por nome acha quem já tem fixo e quem é de outra turma", () => {
  assert.deepEqual(run("duda").list.map((i) => i.id), ["comfixo"]);
  assert.deepEqual(run("beto").list.map((i) => i.id), ["antiga"]);
});

test("mesmo dia+período nunca aparece, nem na busca", () => {
  const mesmoSlot = filterCruFixedCandidates({
    interns: INTERNS,
    cruFixed: FIXOS,
    dayOfWeek: "THU",
    period: "DAY",
    ...JANELA,
    search: "duda",
  });
  assert.deepEqual(mesmoSlot.list, []);
});

test("turma que começa dentro da janela continua visível", () => {
  const encosta = filterCruFixedCandidates({
    interns: [{ id: "x", name: "Encosta", cohortStart: "2026-09-13", cohortEnd: "2026-10-30" }],
    cruFixed: [],
    dayOfWeek: "FRI",
    period: "DAY",
    ...JANELA,
    search: "",
  });
  assert.deepEqual(encosta.list.map((i) => i.id), ["x"]);
});

test("turma que começa depois do fim da janela some", () => {
  const depois = filterCruFixedCandidates({
    interns: [{ id: "y", name: "Só em outubro", cohortStart: "2026-10-05", cohortEnd: "2026-11-15" }],
    cruFixed: [],
    dayOfWeek: "FRI",
    period: "DAY",
    ...JANELA,
    search: "",
  });
  assert.deepEqual(depois.list, []);
  assert.equal(depois.hiddenOtherCohort, 1);
});

test("janela de uma semana só: a turma corrente continua na lista", () => {
  // weeks=1 no meio da semana — mustReach cai no domingo, não na próxima segunda
  const semanaUnica = filterCruFixedCandidates({
    interns: INTERNS,
    cruFixed: [],
    dayOfWeek: "FRI",
    period: "DAY",
    mustReach: "2026-08-09",
    windowEnd: "2026-08-09",
    search: "",
  });
  assert.deepEqual(semanaUnica.list.map((i) => i.id), ["antiga", "semturma"]);
});
