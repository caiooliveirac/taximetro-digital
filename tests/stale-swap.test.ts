import test from "node:test";
import assert from "node:assert/strict";
import { isStaleSwap } from "../src/features/requests/application/use-cases/list-requests";

const TODAY = "2026-07-30";
const row = (over: Partial<Parameters<typeof isStaleSwap>[0]>) => ({
  type: "SWAP",
  status: "OPEN",
  assignmentDate: null,
  targetAssignmentDate: null,
  ...over,
});

test("oferta aberta com plantão passado é descartada", () => {
  assert.equal(isStaleSwap(row({ assignmentDate: "2026-07-29" }), TODAY), true);
});

test("oferta do próprio dia continua visível", () => {
  assert.equal(isStaleSwap(row({ assignmentDate: TODAY }), TODAY), false);
});

test("proposta com contraoferta vencida é descartada", () => {
  assert.equal(
    isStaleSwap(row({ status: "PENDING", assignmentDate: "2026-08-10", targetAssignmentDate: "2026-07-01" }), TODAY),
    true,
  );
});

test("troca concluída no passado permanece no histórico", () => {
  assert.equal(isStaleSwap(row({ status: "COMPLETED", assignmentDate: "2026-01-01" }), TODAY), false);
});

test("extra passado não é afetado", () => {
  assert.equal(isStaleSwap(row({ type: "EXTRA_SHIFT", assignmentDate: "2026-01-01" }), TODAY), false);
});
