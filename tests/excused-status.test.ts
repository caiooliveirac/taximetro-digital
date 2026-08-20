/**
 * Falta abonada (EXCUSED) tem status próprio: nunca vira presença fabricada
 * (foi o bug de 2026-08-18, com check-in/checkout sintéticos), mas conta como
 * carga horária cumprida no relatório — quem abona é admin ou preceptor, e o
 * card sai marcado como abono, com o motivo por extenso. Estes testes travam
 * as duas metades: cumprido no relatório, cor própria no heatmap.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { classifyReportAssignment, classifyHeatmapCell } from "../src/lib/admin-report-builder";
import { manualAttendanceSchema } from "../src/features/admin-attendance/application/use-cases/handle-manual-attendance";

const base = { date: "2026-08-10", period: "DAY" as const };

test("EXCUSED conta como carga horária cumprida no relatório", () => {
  const group = classifyReportAssignment({ ...base, status: "EXCUSED" }, "2026-08-18", 10);
  assert.equal(group, "done");
});

test("falta sem abono continua no grupo de faltas", () => {
  const group = classifyReportAssignment({ ...base, status: "ABSENT" }, "2026-08-18", 10);
  assert.equal(group, "absent");
});

test("EXCUSED tem célula própria no heatmap, distinta de cumprido e de falta", () => {
  const cell = classifyHeatmapCell(
    { ...base, status: "EXCUSED", isExtraShift: false, baseType: "USA" },
    "2026-08-18",
    10,
  );
  assert.equal(cell, "excused");
});

test("abono sem motivo é recusado — é o motivo que justifica a carga horária", () => {
  const semMotivo = manualAttendanceSchema.safeParse({
    assignmentId: "00000000-0000-4000-8000-000000000000",
    action: "EXCUSE_ABSENCE",
  });
  assert.equal(semMotivo.success, false);

  const comMotivo = manualAttendanceSchema.safeParse({
    assignmentId: "00000000-0000-4000-8000-000000000000",
    action: "EXCUSE_ABSENCE",
    justification: "Liberado pela coordenação da faculdade devido a uma prova",
  });
  assert.equal(comMotivo.success, true);
});

test("falta continua podendo ser lançada sem texto", () => {
  const parsed = manualAttendanceSchema.safeParse({
    assignmentId: "00000000-0000-4000-8000-000000000000",
    action: "MARK_ABSENT",
  });
  assert.equal(parsed.success, true);
});
