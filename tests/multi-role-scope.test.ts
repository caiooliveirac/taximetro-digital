/**
 * Corte B — roles[] enriquecida com escopo (facultyId/baseId).
 *
 * Foco: garantir que o helper `src/lib/roles.ts` continua aceitando JWTs
 * legados (Role[] string) E novos (SessionRole[] objeto), e que o scope
 * passa a funcionar quando os dados estao presentes.
 *
 * Rodar: npx tsx --test tests/multi-role-scope.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionHasRole, sessionHasAnyRole, tokenHasRole } from "../src/lib/roles";

function fakeSession(roles: any): any {
  return { user: { id: "u1", roles } };
}

// ==================== Transicao: JWTs legados continuam aceitos ====================

test("Legacy JWT (Role[] string) — sessionHasRole continua funcionando sem scope", () => {
  const session = fakeSession(["LEADER", "INTERN"]);
  assert.equal(sessionHasRole(session, "INTERN"), true);
  assert.equal(sessionHasRole(session, "PRECEPTOR"), false);
});

test("Legacy JWT (Role[] string) — sessionHasAnyRole continua funcionando", () => {
  const session = fakeSession(["LEADER"]);
  assert.equal(sessionHasAnyRole(session, ["LEADER", "COORDINATOR"]), true);
  assert.equal(sessionHasAnyRole(session, ["INTERN"]), false);
});

test("Legacy JWT (Role[] string) — scope solicitado retorna false (fail-closed)", () => {
  const session = fakeSession(["LEADER"]);
  assert.equal(sessionHasRole(session, "LEADER", { facultyId: "fac-1" }), false);
});

// ==================== Novos JWTs (SessionRole[] enriquecido) ====================

test("Novo JWT (SessionRole[]) — sem scope, comportamento identico", () => {
  const session = fakeSession([
    { role: "LEADER", facultyId: "fac-ufba", baseId: null },
    { role: "INTERN", facultyId: "fac-ufba", baseId: null },
  ]);
  assert.equal(sessionHasRole(session, "INTERN"), true);
  assert.equal(sessionHasRole(session, "LEADER"), true);
  assert.equal(sessionHasRole(session, "PRECEPTOR"), false);
});

test("Novo JWT (SessionRole[]) — scope facultyId match", () => {
  const session = fakeSession([
    { role: "LEADER", facultyId: "fac-ufba", baseId: null },
    { role: "INTERN", facultyId: "fac-ufba", baseId: null },
  ]);
  assert.equal(sessionHasRole(session, "INTERN", { facultyId: "fac-ufba" }), true);
});

test("Novo JWT (SessionRole[]) — scope facultyId mismatch", () => {
  const session = fakeSession([
    { role: "LEADER", facultyId: "fac-ufba", baseId: null },
  ]);
  assert.equal(sessionHasRole(session, "LEADER", { facultyId: "fac-unifacs" }), false);
});

test("Novo JWT (SessionRole[]) — PRECEPTOR com baseId", () => {
  const session = fakeSession([
    { role: "LEADER", facultyId: "fac-ufba", baseId: null },
    { role: "PRECEPTOR", facultyId: null, baseId: "base-cb02" },
  ]);
  assert.equal(sessionHasRole(session, "PRECEPTOR", { baseId: "base-cb02" }), true);
  assert.equal(sessionHasRole(session, "PRECEPTOR", { baseId: "base-cb05" }), false);
});

test("Novo JWT — usuario com mesma role em duas faculdades distintas (caso multi-faculty)", () => {
  const session = fakeSession([
    { role: "INTERN", facultyId: "fac-ufba", baseId: null },
    { role: "INTERN", facultyId: "fac-unifacs", baseId: null },
  ]);
  assert.equal(sessionHasRole(session, "INTERN", { facultyId: "fac-ufba" }), true);
  assert.equal(sessionHasRole(session, "INTERN", { facultyId: "fac-unifacs" }), true);
  assert.equal(sessionHasRole(session, "INTERN", { facultyId: "fac-afya" }), false);
});

// ==================== Misturado: JWT em transicao com mix string/objeto ====================

test("Mix string + objeto na mesma roles[] — ambos sao reconhecidos", () => {
  const session = fakeSession([
    "LEADER",
    { role: "INTERN", facultyId: "fac-ufba", baseId: null },
  ]);
  assert.equal(sessionHasRole(session, "LEADER"), true);
  assert.equal(sessionHasRole(session, "INTERN"), true);
  // Scope so funciona na entrada que carrega facultyId:
  assert.equal(sessionHasRole(session, "INTERN", { facultyId: "fac-ufba" }), true);
  assert.equal(sessionHasRole(session, "LEADER", { facultyId: "fac-ufba" }), false);
});

// ==================== Defesa: dados invalidos no objeto ====================

test("Objeto sem facultyId/baseId — scope solicitado retorna false", () => {
  const session = fakeSession([{ role: "LEADER", facultyId: null, baseId: null }]);
  assert.equal(sessionHasRole(session, "LEADER"), true);
  assert.equal(sessionHasRole(session, "LEADER", { facultyId: "fac-1" }), false);
});

test("tokenHasRole espelha com SessionRole[]", () => {
  const token: any = {
    id: "u1",
    roles: [
      { role: "LEADER", facultyId: "fac-ufba", baseId: null },
      { role: "PRECEPTOR", facultyId: null, baseId: "base-cb02" },
    ],
  };
  assert.equal(tokenHasRole(token, "PRECEPTOR", { baseId: "base-cb02" }), true);
  assert.equal(tokenHasRole(token, "LEADER", { facultyId: "fac-ufba" }), true);
  assert.equal(tokenHasRole(token, "INTERN"), false);
});
