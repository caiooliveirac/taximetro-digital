import { strict as assert } from "node:assert";
import test from "node:test";
import { internsBeyondEnd, planCohortClosure } from "../src/features/cohorts/domain/cohort-closure";
import { buildCohortReportFilters } from "../src/lib/report-filters";

const ana = { userRoleId: "ana", name: "Ana", lastShiftDate: "2026-09-28" };
const beto = { userRoleId: "beto", name: "Beto", lastShiftDate: "2026-10-15" };
const caio = { userRoleId: "caio", name: "Caio", lastShiftDate: null };
const duda = { userRoleId: "duda", name: "Duda", lastShiftDate: "2026-10-11" };

test("antes do fim da turma ninguém é arquivado", () => {
  const plan = planCohortClosure({ endDate: "2026-10-11", today: "2026-10-11", interns: [ana, caio] });
  assert.equal(plan.ended, false);
  assert.deepEqual(plan.toArchive, []);
  assert.equal(plan.closeCohort, false);
});

test("depois do fim, arquiva só quem não tem plantão de hoje em diante; turma segue aberta", () => {
  const plan = planCohortClosure({ endDate: "2026-09-30", today: "2026-10-11", interns: [ana, beto, caio, duda] });
  assert.deepEqual(plan.toArchive.map((i) => i.userRoleId), ["ana", "caio"]);
  // Plantão hoje ainda segura: arquiva na rodada de amanhã.
  assert.deepEqual(plan.pending.map((i) => i.userRoleId), ["duda", "beto"]);
  assert.equal(plan.closeCohort, false);
});

test("passado o último plantão do último interno, a turma fecha", () => {
  const plan = planCohortClosure({ endDate: "2026-09-30", today: "2026-10-16", interns: [ana, beto, caio] });
  assert.equal(plan.toArchive.length, 3);
  assert.equal(plan.closeCohort, true);
});

test("turma vencida sem interno ativo fecha", () => {
  assert.equal(planCohortClosure({ endDate: "2026-09-30", today: "2026-10-01", interns: [] }).closeCohort, true);
});

test("aviso antecipado lista só plantão depois do fim e ainda por vir", () => {
  const late = internsBeyondEnd("2026-10-12", "2026-10-11", [ana, beto, caio, duda]);
  assert.deepEqual(late.map((i) => i.userRoleId), ["beto"]);
  // Depois do fim, plantão velho que ficou SCHEDULED não conta.
  assert.deepEqual(internsBeyondEnd("2026-09-20", "2026-10-11", [ana, beto, duda]).map((i) => i.userRoleId), ["beto", "duda"]);
});

test("relatório de encerramento vai até a reposição depois do fim", () => {
  const base = { id: "6f1c1d2e-0000-4000-8000-000000000001", facultyId: "6f1c1d2e-0000-4000-8000-000000000002", startDate: "2026-08-20", endDate: "2026-09-30" };
  assert.equal(buildCohortReportFilters({ ...base, lastShiftDate: "2026-10-15" }).to, "2026-10-15");
  assert.equal(buildCohortReportFilters({ ...base, lastShiftDate: "2026-09-10" }).to, "2026-09-30");
  assert.equal(buildCohortReportFilters({ ...base, lastShiftDate: null }).to, "2026-09-30");
});
