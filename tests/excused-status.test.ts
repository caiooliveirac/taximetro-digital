/**
 * Falta abonada (EXCUSED) nunca pode voltar a parecer presença. Foi o bug de
 * 2026-08-18: o abono fabricava check-in/checkout sintéticos e o plantão saía
 * como CHECKED_OUT nos relatórios. Estes testes travam a classificação.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { classifyReportAssignment, classifyHeatmapCell } from "../src/lib/admin-report-builder";

const base = { date: "2026-08-10", period: "DAY" as const };

test("EXCUSED entra no grupo de faltas do relatório, nunca em done", () => {
  const group = classifyReportAssignment({ ...base, status: "EXCUSED" }, "2026-08-18", 10);
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
