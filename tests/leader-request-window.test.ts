import test from "node:test";
import assert from "node:assert/strict";
import { isTodayOrFutureRequest } from "../src/features/requests/domain/request-shift-window";

// 2026-07-30 10:00 em São Paulo (UTC-3) = 13:00Z. O diurno de hoje já começou —
// e mesmo assim a solicitação de hoje continua na tela: o corte é a data.
const NOW = new Date("2026-07-30T13:00:00Z");
const TODAY = "2026-07-30";

const req = (over: Partial<Parameters<typeof isTodayOrFutureRequest>[0]>) => ({
  type: "DROP_SHIFT",
  ...over,
});

test("descarte de ontem sai da lista", () => {
  assert.equal(isTodayOrFutureRequest(req({ assignmentDate: "2026-07-29", assignmentPeriod: "DAY" }), NOW), false);
});

test("descarte de maio sai da lista", () => {
  assert.equal(isTodayOrFutureRequest(req({ assignmentDate: "2026-05-14", assignmentPeriod: "NIGHT" }), NOW), false);
});

test("descarte de hoje fica, mesmo com o turno já em curso", () => {
  assert.equal(isTodayOrFutureRequest(req({ assignmentDate: TODAY, assignmentPeriod: "DAY" }), NOW), true);
  assert.equal(isTodayOrFutureRequest(req({ assignmentDate: TODAY, assignmentPeriod: "NIGHT" }), NOW), true);
});

test("hoje continua na tela até a virada do dia", () => {
  const hoje = req({ assignmentDate: TODAY, assignmentPeriod: "DAY" });
  // 23:30 local de hoje ainda é hoje; 00:30 local já é amanhã e o plantão vira passado.
  assert.equal(isTodayOrFutureRequest(hoje, new Date("2026-07-31T02:30:00Z")), true);
  assert.equal(isTodayOrFutureRequest(hoje, new Date("2026-07-31T03:30:00Z")), false);
});

test("extra futuro fica, extra de data passada sai", () => {
  assert.equal(isTodayOrFutureRequest(req({ type: "EXTRA_SHIFT", extraDate: "2026-08-05", extraPeriod: "DAY" }), NOW), true);
  assert.equal(isTodayOrFutureRequest(req({ type: "EXTRA_SHIFT", extraDate: TODAY, extraPeriod: "DAY" }), NOW), true);
  assert.equal(isTodayOrFutureRequest(req({ type: "EXTRA_SHIFT", extraDate: "2026-07-01", extraPeriod: "DAY" }), NOW), false);
});

test("troca sai quando qualquer um dos dois lados é de data passada", () => {
  const swap = {
    type: "SWAP",
    assignmentDate: "2026-08-10", assignmentPeriod: "DAY",
    targetAssignmentDate: "2026-07-01", targetAssignmentPeriod: "DAY",
  };
  assert.equal(isTodayOrFutureRequest(swap, NOW), false);
  assert.equal(isTodayOrFutureRequest({ ...swap, targetAssignmentDate: "2026-08-11" }, NOW), true);
});

test("troca concluída no passado não volta para a tela do líder", () => {
  assert.equal(isTodayOrFutureRequest(req({ type: "SWAP", assignmentDate: "2026-01-01", assignmentPeriod: "DAY" }), NOW), false);
});

test("solicitação sem plantão vinculado continua visível", () => {
  assert.equal(isTodayOrFutureRequest(req({ assignmentDate: null, extraDate: null }), NOW), true);
});
