import { strict as assert } from "node:assert";
import test from "node:test";
import { defaultInviteCohortId, pickOpenCohort, planNextCohort } from "../src/features/cohorts/domain/intern-cohort";

const fechada = { id: "afya5", status: "CLOSED" as const, startDate: "2026-09-07", endDate: "2026-09-30" };
const saindo = { id: "u3", status: "ACTIVE" as const, startDate: "2026-09-14", endDate: "2026-10-25" };
const chegando = { id: "u4", status: "ACTIVE" as const, startDate: "2026-10-26", endDate: "2026-12-06" };
const planejada = { id: "u5", status: "PLANNED" as const, startDate: "2026-12-07", endDate: "2027-01-17" };

test("faculdade só com turma fechada não tem turma aberta", () => {
  assert.equal(pickOpenCohort([fechada], "2026-10-26"), null);
});

test("turma vencida que segue ACTIVE (reposição pendente) não recebe interno novo", () => {
  assert.equal(pickOpenCohort([saindo], "2026-10-26"), null);
});

test("ACTIVE vence PLANNED e a mais recente vence a que está saindo", () => {
  assert.equal(pickOpenCohort([saindo, planejada, chegando], "2026-10-25")?.id, "u4");
  assert.equal(pickOpenCohort([planejada, fechada], "2026-10-26")?.id, "u5");
});

test("próxima turma segue a numeração e dura o mesmo que a última", () => {
  const plan = planNextCohort({
    facultyAbbr: "AFYA",
    today: "2026-10-26",
    last: { rotationNumber: 5, status: "CLOSED", startDate: "2026-09-07", endDate: "2026-09-30" },
  });
  assert.deepEqual(plan, {
    rotationNumber: 6,
    startDate: "2026-10-26",
    endDate: "2026-11-18",
    name: "AFYA 6",
    label: "AFYA 6",
  });
});

test("faculdade sem turma nenhuma começa na 1 com rodízio padrão", () => {
  const plan = planNextCohort({ facultyAbbr: "Pós UE", today: "2026-10-26", last: null });
  assert.equal(plan.rotationNumber, 1);
  assert.equal(plan.name, "Pós UE 1");
  assert.equal(plan.endDate, "2026-12-06");
});

test("nova turma criada com a atual em curso começa no dia seguinte ao fim dela", () => {
  const plan = planNextCohort({
    facultyAbbr: "UNIME",
    today: "2026-11-30",
    last: { rotationNumber: 4, status: "ACTIVE", startDate: "2026-10-26", endDate: "2026-12-06" },
  });
  assert.equal(plan.startDate, "2026-12-07");
  assert.equal(plan.endDate, "2027-01-17");
});

test("convite: turma em curso é o padrão até a 3ª semana; da 4ª em diante, nova turma", () => {
  assert.equal(defaultInviteCohortId([chegando], "2026-10-26"), "u4");
  assert.equal(defaultInviteCohortId([chegando], "2026-11-15"), "u4");
  assert.equal(defaultInviteCohortId([chegando], "2026-11-16"), "");
});

test("convite: turma futura já criada é o padrão; sem turma aberta, nova turma", () => {
  assert.equal(defaultInviteCohortId([chegando, planejada], "2026-11-30"), "u5");
  assert.equal(defaultInviteCohortId([fechada], "2026-10-26"), "");
});
