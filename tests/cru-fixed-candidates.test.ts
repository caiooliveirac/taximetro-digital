import { strict as assert } from "node:assert";
import test from "node:test";
import { filterCruFixedCandidates } from "../src/features/scheduling/domain/policies/cru-fixed-candidates";

// Hoje 08/08 (sábado): a turma precisa alcançar a segunda que vem para ter rodízio.
const JANELA = { mustReach: "2026-08-10" };

const INTERNS = [
  { id: "atual", name: "Ana Turma Atual", cohortStart: "2026-08-10", cohortEnd: "2026-09-20" },
  // turma que acaba no domingo desta semana: não tem rodízio a receber
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

test("lista padrão: turma vigente e sem fixo", () => {
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

test("turma que ainda vai começar continua na lista", () => {
  // a janela do rodízio é a da turma dela; a materialização respeita o valid_from
  const futura = filterCruFixedCandidates({
    interns: [{ id: "x", name: "Turma de outubro", cohortStart: "2026-10-05", cohortEnd: "2026-11-15" }],
    cruFixed: [],
    dayOfWeek: "FRI",
    period: "DAY",
    ...JANELA,
    search: "",
  });
  assert.deepEqual(futura.list.map((i) => i.id), ["x"]);
});
