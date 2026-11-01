import { test } from "node:test";
import assert from "node:assert/strict";
import { executeManualAttendance } from "../src/features/admin-attendance/application/use-cases/handle-manual-attendance";

const assignmentId = "00000000-0000-4000-8000-000000000001";
const preceptor = { id: "p1", name: "Preceptor", role: "PRECEPTOR" as const };

test("preceptor não abona falta", async () => {
  const result = await executeManualAttendance({
    actor: preceptor,
    input: { assignmentId, action: "EXCUSE_ABSENCE", justification: "motivo" },
  });
  assert.equal(result.status, 403);
});

test("preceptor não dá checkout manual em nome de outro (fura a janela do turno)", async () => {
  const result = await executeManualAttendance({ actor: preceptor, input: { assignmentId, action: "CONFIRM_CHECKOUT" } });
  assert.equal(result.status, 403);
});
