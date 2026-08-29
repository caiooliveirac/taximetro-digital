import test from "node:test";
import assert from "node:assert/strict";
import { isFutureShiftRequest } from "../src/features/requests/domain/request-shift-window";

// 2026-07-30 10:00 em São Paulo (UTC-3) = 13:00Z. Diurno já começou, noturno
// (18:00) e EBMSP tarde (13:00) ainda não.
const NOW = new Date("2026-07-30T13:00:00Z");
const TODAY = "2026-07-30";

const req = (over: Partial<Parameters<typeof isFutureShiftRequest>[0]>) => ({
  type: "DROP_SHIFT",
  ...over,
});

test("descarte de plantão passado sai da lista", () => {
  assert.equal(isFutureShiftRequest(req({ assignmentDate: "2026-07-29", assignmentPeriod: "DAY" }), NOW), false);
});

test("descarte de hoje cujo turno já começou sai da lista", () => {
  assert.equal(isFutureShiftRequest(req({ assignmentDate: TODAY, assignmentPeriod: "DAY" }), NOW), false);
});

test("descarte de hoje que ainda não começou continua na lista", () => {
  assert.equal(isFutureShiftRequest(req({ assignmentDate: TODAY, assignmentPeriod: "NIGHT" }), NOW), true);
});

test("EBMSP tarde de hoje só sai às 13:00", () => {
  const afternoon = req({ assignmentDate: TODAY, assignmentPeriod: "DAY", assignmentShift: "AFTERNOON" });
  assert.equal(isFutureShiftRequest(afternoon, NOW), true);
  assert.equal(isFutureShiftRequest(afternoon, new Date("2026-07-30T16:00:00Z")), false);
});

test("extra futuro fica, extra passado sai", () => {
  assert.equal(isFutureShiftRequest(req({ type: "EXTRA_SHIFT", extraDate: "2026-08-05", extraPeriod: "DAY" }), NOW), true);
  assert.equal(isFutureShiftRequest(req({ type: "EXTRA_SHIFT", extraDate: "2026-07-01", extraPeriod: "DAY" }), NOW), false);
});

test("troca sai quando qualquer um dos dois lados já começou", () => {
  const swap = {
    type: "SWAP",
    assignmentDate: "2026-08-10", assignmentPeriod: "DAY",
    targetAssignmentDate: "2026-07-01", targetAssignmentPeriod: "DAY",
  };
  assert.equal(isFutureShiftRequest(swap, NOW), false);
  assert.equal(isFutureShiftRequest({ ...swap, targetAssignmentDate: "2026-08-11" }, NOW), true);
});

test("troca concluída no passado não volta para a tela do líder", () => {
  assert.equal(isFutureShiftRequest(req({ type: "SWAP", assignmentDate: "2026-01-01", assignmentPeriod: "DAY" }), NOW), false);
});

test("solicitação sem plantão vinculado continua visível", () => {
  assert.equal(isFutureShiftRequest(req({ assignmentDate: null, extraDate: null }), NOW), true);
});
