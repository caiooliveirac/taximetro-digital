/**
 * Quem o líder pode abrir na ficha de interno. O `internId` chega do cliente;
 * a faculdade não — ela é fixada no servidor. Pedir a ficha de alguém de outra
 * faculdade vira consulta com dois filtros que não se cruzam, não dado alheio.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolveComplianceScope } from "../src/features/compliance/application/use-cases/get-compliance-overview";

const LEADER = { id: "leader-1", role: "LEADER", facultyId: "fac-unifacs" };
const COORD = { id: "coord-1", role: "COORDINATOR", facultyId: null };
const INTERN = { id: "intern-1", role: "INTERN", facultyId: "fac-unifacs" };

test("líder abre a ficha de um interno, com a faculdade dele fixada", () => {
  const scope = resolveComplianceScope({ actor: LEADER, internId: "intern-9" });
  assert.equal(scope.personOnly, "intern-9");
  assert.equal(scope.facultyId, "fac-unifacs");
});

test("líder não escolhe a faculdade — o pedido do cliente é sobrescrito", () => {
  const scope = resolveComplianceScope({
    actor: LEADER,
    facultyId: "fac-outra",
    internId: "intern-de-outra-faculdade",
  });
  assert.equal(scope.facultyId, "fac-unifacs");
});

test("sem internId, o líder vê a faculdade inteira", () => {
  const scope = resolveComplianceScope({ actor: LEADER });
  assert.equal(scope.personOnly, null);
  assert.equal(scope.facultyId, "fac-unifacs");
});

test("líder pedindo o próprio cumprimento vê a si, com o papel de interno junto", () => {
  const scope = resolveComplianceScope({ actor: LEADER, selfOnly: true, internId: "intern-9" });
  assert.equal(scope.personOnly, "leader-1");
  assert.deepEqual(scope.roleFilter, ["INTERN", "LEADER"]);
});

test("coordenador abre qualquer interno, sem recorte de faculdade", () => {
  const scope = resolveComplianceScope({ actor: COORD, internId: "intern-9" });
  assert.equal(scope.personOnly, "intern-9");
  assert.equal(scope.facultyId, null);
});

test("interno só vê a si, mesmo pedindo outro internId", () => {
  const scope = resolveComplianceScope({ actor: INTERN, internId: "intern-9" });
  assert.equal(scope.personOnly, "intern-1");
});
