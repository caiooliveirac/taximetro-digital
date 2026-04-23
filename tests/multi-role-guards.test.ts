/**
 * Corte A — Multi-role guards. Testes unitários do helper central
 * `src/lib/roles.ts`. Como o projeto não tem framework de testes instalado,
 * usamos o runner nativo `node:test` (zero deps).
 *
 * Os 4 endpoints refatorados (attendance/validate, /checkout, /checkin,
 * /slots/available) delegam toda a decisão de role a este helper. Portanto,
 * cobrir o helper trava as duas ansiedades do corte:
 *
 *   Medo 1 (vazamento): sessão sem role ou malformada NUNCA retorna true.
 *   Medo 2 (regressão): LEADER+INTERN e LEADER+PRECEPTOR passam nos guards
 *                       correspondentes ao endpoint em que atuam.
 *
 * Rodar:
 *   npx tsx --test tests/multi-role-guards.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { sessionHasRole, sessionHasAnyRole, tokenHasRole } from "../src/lib/roles";

// ------------ Fakes mínimos de Session ------------
type Roles = Array<string | { role: string; facultyId?: string | null; baseId?: string | null }>;

function fakeSession(roles: Roles | undefined | null): Session | null | undefined {
  if (roles === undefined) return undefined;
  if (roles === null) return null;
  return { user: { id: "u1", roles } } as unknown as Session;
}

function fakeToken(roles: Roles | undefined | null): JWT | null | undefined {
  if (roles === undefined) return undefined;
  if (roles === null) return null;
  return { id: "u1", roles } as unknown as JWT;
}

// ==================== Medo 1 — Não vazar permissão ====================

test("Caso 1: LEADER-puro → NÃO pode validar (sem PRECEPTOR/COORDINATOR)", () => {
  const session = fakeSession(["LEADER"]);
  assert.equal(sessionHasAnyRole(session, ["PRECEPTOR", "COORDINATOR"]), false);
});

test("Caso 2: LEADER-puro → NÃO pode confirmar checkout (sem PRECEPTOR/COORDINATOR)", () => {
  const session = fakeSession(["LEADER"]);
  assert.equal(sessionHasAnyRole(session, ["COORDINATOR", "PRECEPTOR"]), false);
});

test("Caso 3: INTERN-puro → NÃO pode validar presença (sem PRECEPTOR)", () => {
  const session = fakeSession(["INTERN"]);
  assert.equal(sessionHasAnyRole(session, ["PRECEPTOR", "COORDINATOR"]), false);
});

// ==================== Medo 2 — Restaurar funcionamento legítimo ====================

test("Caso 4: [LEADER, INTERN] → PODE fazer check-in (tem INTERN ativa)", () => {
  const session = fakeSession(["LEADER", "INTERN"]);
  assert.equal(sessionHasRole(session, "INTERN"), true);
});

test("Caso 5: [LEADER, PRECEPTOR] → PODE validar (tem PRECEPTOR ativa)", () => {
  const session = fakeSession(["LEADER", "PRECEPTOR"]);
  assert.equal(sessionHasAnyRole(session, ["PRECEPTOR", "COORDINATOR"]), true);
});

test("Caso 6: COORDINATOR → PODE validar (mantém capacidade existente)", () => {
  const session = fakeSession(["COORDINATOR"]);
  assert.equal(sessionHasAnyRole(session, ["PRECEPTOR", "COORDINATOR"]), true);
});

// ==================== Medo 1 (defesa em profundidade) — Sessão malformada ====================

test("Caso 7a: session = null → 403 (helper retorna false)", () => {
  assert.equal(sessionHasRole(null, "INTERN"), false);
  assert.equal(sessionHasAnyRole(null, ["PRECEPTOR", "COORDINATOR"]), false);
});

test("Caso 7b: session = undefined → 403", () => {
  assert.equal(sessionHasRole(undefined, "INTERN"), false);
  assert.equal(sessionHasAnyRole(undefined, ["PRECEPTOR", "COORDINATOR"]), false);
});

test("Caso 7c: session.user.roles = undefined → 403", () => {
  const session = { user: { id: "u1" } } as unknown as Session;
  assert.equal(sessionHasRole(session, "INTERN"), false);
  assert.equal(sessionHasAnyRole(session, ["PRECEPTOR", "COORDINATOR"]), false);
});

test("Caso 7d: session.user.roles = [] → 403", () => {
  const session = fakeSession([]);
  assert.equal(sessionHasRole(session, "INTERN"), false);
  assert.equal(sessionHasAnyRole(session, ["PRECEPTOR", "COORDINATOR"]), false);
});

test("Caso 7e: roles contém valores inválidos → ignora silenciosamente", () => {
  const session = { user: { roles: ["GARBAGE", null, 42, { role: "FAKE" }, { role: "INTERN" }] } } as unknown as Session;
  assert.equal(sessionHasRole(session, "INTERN"), true);
  assert.equal(sessionHasRole(session, "LEADER"), false);
  assert.equal(sessionHasAnyRole(session, ["PRECEPTOR", "COORDINATOR"]), false);
});

test("Caso 7f: roles como objeto malformado (sem role) → não vaza", () => {
  const session = { user: { roles: [{ facultyId: "x" }] } } as unknown as Session;
  assert.equal(sessionHasRole(session, "INTERN"), false);
});

// ==================== Cobertura adicional — scope fail-closed ====================

test("Scope: com entradas string (forma atual Role[]) e scope solicitado → false", () => {
  // Hoje NextAuth popula roles como Role[]. O helper NÃO concede permissão
  // baseada em scope quando a entrada não carrega facultyId/baseId.
  const session = fakeSession(["LEADER"]);
  assert.equal(sessionHasRole(session, "LEADER", { facultyId: "fac-1" }), false);
});

test("Scope: com entradas objeto + scope match → true", () => {
  const session = fakeSession([{ role: "LEADER", facultyId: "fac-1", baseId: null }]);
  assert.equal(sessionHasRole(session, "LEADER", { facultyId: "fac-1" }), true);
  assert.equal(sessionHasRole(session, "LEADER", { facultyId: "fac-2" }), false);
});

// ==================== tokenHasRole espelha a semântica ====================

test("tokenHasRole: mesma semântica de sessionHasRole", () => {
  assert.equal(tokenHasRole(fakeToken(["LEADER", "INTERN"]), "INTERN"), true);
  assert.equal(tokenHasRole(fakeToken(["LEADER"]), "INTERN"), false);
  assert.equal(tokenHasRole(null, "INTERN"), false);
  assert.equal(tokenHasRole(undefined, "INTERN"), false);
  assert.equal(tokenHasRole(fakeToken([]), "INTERN"), false);
});
