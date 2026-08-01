import test from "node:test";
import assert from "node:assert/strict";
import { isStaleSwap } from "../src/features/requests/application/use-cases/list-requests";

// 2026-07-30 10:00 em São Paulo (UTC-3) = 13:00Z. Diurno já começou (07:00),
// noturno ainda não (18:00).
const NOW = new Date("2026-07-30T13:00:00Z");
const TODAY = "2026-07-30";

const row = (over: Partial<Parameters<typeof isStaleSwap>[0]>) => ({
  type: "SWAP",
  status: "OPEN",
  assignmentDate: null,
  targetAssignmentDate: null,
  ...over,
});

test("oferta aberta com plantão passado é descartada", () => {
  assert.equal(isStaleSwap(row({ assignmentDate: "2026-07-29" }), NOW), true);
});

test("plantão de hoje cujo turno já começou some", () => {
  assert.equal(isStaleSwap(row({ assignmentDate: TODAY, assignmentPeriod: "DAY" }), NOW), true);
});

test("plantão de hoje que ainda não começou continua visível", () => {
  assert.equal(isStaleSwap(row({ assignmentDate: TODAY, assignmentPeriod: "NIGHT" }), NOW), false);
});

test("EBMSP tarde de hoje só some às 13:00", () => {
  const beforeAfternoon = row({ assignmentDate: TODAY, assignmentPeriod: "DAY", assignmentShift: "AFTERNOON" });
  assert.equal(isStaleSwap(beforeAfternoon, NOW), false);
  assert.equal(isStaleSwap(beforeAfternoon, new Date("2026-07-30T16:00:00Z")), true);
});

test("proposta com contraoferta vencida é descartada", () => {
  assert.equal(
    isStaleSwap(row({ status: "PENDING", assignmentDate: "2026-08-10", targetAssignmentDate: "2026-07-01" }), NOW),
    true,
  );
});

test("troca concluída no passado permanece no histórico", () => {
  assert.equal(isStaleSwap(row({ status: "COMPLETED", assignmentDate: "2026-01-01" }), NOW), false);
});

test("extra passado não é afetado", () => {
  assert.equal(isStaleSwap(row({ type: "EXTRA_SHIFT", assignmentDate: "2026-01-01" }), NOW), false);
});
