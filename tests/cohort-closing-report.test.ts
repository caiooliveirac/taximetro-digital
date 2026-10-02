import { strict as assert } from "node:assert";
import test from "node:test";
import { cohortClosingReportFileName } from "../src/lib/email";
import { buildCohortReportFilters, reportFilterInputSchema } from "../src/lib/report-filters";

test("nome do anexo traz faculdade, turma sem acento e as datas", () => {
  assert.equal(
    cohortClosingReportFileName({
      facultyAbbr: "UFBA",
      cohortName: "Jéssica Costa / Set",
      startDate: "2026-07-20",
      endDate: "2026-08-30",
    }),
    "Relatorio_UFBA_Jessica-Costa-Set_2026-07-20_a_2026-08-30.html",
  );
});

test("filtros do relatório de encerramento cobrem a turma inteira, do início ao fim", () => {
  const filters = buildCohortReportFilters({
    id: "6f1c1d2e-0000-4000-8000-000000000001",
    facultyId: "6f1c1d2e-0000-4000-8000-000000000002",
    startDate: "2026-07-20",
    endDate: "2026-08-30",
  });
  assert.ok(reportFilterInputSchema.safeParse(filters).success);
  assert.equal(filters.scopeMode, "COHORT");
  assert.equal(filters.cohortGrouping, "NAMED_COHORT");
  assert.deepEqual(filters.selectedCohorts, ["6f1c1d2e-0000-4000-8000-000000000001"]);
  assert.equal(filters.from, "2026-07-20");
  assert.equal(filters.to, "2026-08-30");
});
