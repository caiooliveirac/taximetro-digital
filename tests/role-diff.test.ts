import test from "node:test";
import assert from "node:assert/strict";
import {
  computeRoleDiff,
  normalizeRolesPayload,
  type ExistingRoleRow,
  type RoleAssignment,
} from "../src/lib/roles";

const FACULTY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const FACULTY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const BASE_X = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const BASE_Y = "dddddddd-dddd-dddd-dddd-dddddddddddd";

// ===== computeRoleDiff =====

test("diff: usuario sem roles + desejado [LEADER@A] => 1 insert, 0 deactivate, 0 reactivate", () => {
  const existing: ExistingRoleRow[] = [];
  const desired: RoleAssignment[] = [{ role: "LEADER", facultyId: FACULTY_A, baseId: null }];
  const diff = computeRoleDiff(existing, desired);
  assert.equal(diff.toInsert.length, 1);
  assert.equal(diff.toInsert[0].role, "LEADER");
  assert.equal(diff.toDeactivate.length, 0);
  assert.equal(diff.toReactivate.length, 0);
});

test("diff: role ativa identica ao desejado => no-op", () => {
  const existing: ExistingRoleRow[] = [
    { id: "r1", role: "LEADER", facultyId: FACULTY_A, baseId: null, isActive: true },
  ];
  const desired: RoleAssignment[] = [{ role: "LEADER", facultyId: FACULTY_A, baseId: null }];
  const diff = computeRoleDiff(existing, desired);
  assert.equal(diff.toInsert.length, 0);
  assert.equal(diff.toDeactivate.length, 0);
  assert.equal(diff.toReactivate.length, 0);
});

test("diff: role ativa removida do desejado => toDeactivate (nunca delete)", () => {
  const existing: ExistingRoleRow[] = [
    { id: "r1", role: "LEADER", facultyId: FACULTY_A, baseId: null, isActive: true },
    { id: "r2", role: "INTERN", facultyId: FACULTY_A, baseId: null, isActive: true },
  ];
  const desired: RoleAssignment[] = [{ role: "LEADER", facultyId: FACULTY_A, baseId: null }];
  const diff = computeRoleDiff(existing, desired);
  assert.equal(diff.toDeactivate.length, 1);
  assert.equal(diff.toDeactivate[0], "r2");
  assert.equal(diff.toInsert.length, 0);
});

test("diff: role inativa re-pedida => toReactivate (evita violar uq_user_role_faculty)", () => {
  const existing: ExistingRoleRow[] = [
    { id: "r1", role: "LEADER", facultyId: FACULTY_A, baseId: null, isActive: false },
  ];
  const desired: RoleAssignment[] = [{ role: "LEADER", facultyId: FACULTY_A, baseId: null }];
  const diff = computeRoleDiff(existing, desired);
  assert.equal(diff.toReactivate.length, 1);
  assert.equal(diff.toReactivate[0], "r1");
  assert.equal(diff.toInsert.length, 0);
  assert.equal(diff.toDeactivate.length, 0);
});

test("diff: facultyId diferente e' role diferente (INTERN@A vs INTERN@B coexistem)", () => {
  const existing: ExistingRoleRow[] = [
    { id: "r1", role: "INTERN", facultyId: FACULTY_A, baseId: null, isActive: true },
  ];
  const desired: RoleAssignment[] = [
    { role: "INTERN", facultyId: FACULTY_A, baseId: null },
    { role: "INTERN", facultyId: FACULTY_B, baseId: null },
  ];
  const diff = computeRoleDiff(existing, desired);
  assert.equal(diff.toInsert.length, 1);
  assert.equal(diff.toInsert[0].facultyId, FACULTY_B);
  assert.equal(diff.toDeactivate.length, 0);
});

test("diff: troca facultyId de LEADER => desativa antiga + insere nova", () => {
  const existing: ExistingRoleRow[] = [
    { id: "r1", role: "LEADER", facultyId: FACULTY_A, baseId: null, isActive: true },
  ];
  const desired: RoleAssignment[] = [{ role: "LEADER", facultyId: FACULTY_B, baseId: null }];
  const diff = computeRoleDiff(existing, desired);
  assert.equal(diff.toInsert.length, 1);
  assert.equal(diff.toInsert[0].facultyId, FACULTY_B);
  assert.equal(diff.toDeactivate.length, 1);
  assert.equal(diff.toDeactivate[0], "r1");
});

test("diff: COORDINATOR + LEADER@A + INTERN@B (3 roles) no mesmo user", () => {
  const existing: ExistingRoleRow[] = [];
  const desired: RoleAssignment[] = [
    { role: "COORDINATOR", facultyId: null, baseId: null },
    { role: "LEADER", facultyId: FACULTY_A, baseId: null },
    { role: "INTERN", facultyId: FACULTY_B, baseId: null },
  ];
  const diff = computeRoleDiff(existing, desired);
  assert.equal(diff.toInsert.length, 3);
});

test("diff: mix ativa + inativa + nova => agrupa corretamente", () => {
  const existing: ExistingRoleRow[] = [
    { id: "r1", role: "LEADER", facultyId: FACULTY_A, baseId: null, isActive: true },
    { id: "r2", role: "PRECEPTOR", facultyId: null, baseId: BASE_X, isActive: false },
    { id: "r3", role: "INTERN", facultyId: FACULTY_A, baseId: null, isActive: true },
  ];
  const desired: RoleAssignment[] = [
    { role: "LEADER", facultyId: FACULTY_A, baseId: null }, // ativa — no-op
    { role: "PRECEPTOR", facultyId: null, baseId: BASE_X }, // inativa — reactivate
    { role: "INTERN", facultyId: FACULTY_B, baseId: null }, // nova — insert
    // INTERN@A (r3) removida do desejado — deactivate
  ];
  const diff = computeRoleDiff(existing, desired);
  assert.equal(diff.toInsert.length, 1);
  assert.equal(diff.toInsert[0].facultyId, FACULTY_B);
  assert.equal(diff.toReactivate.length, 1);
  assert.equal(diff.toReactivate[0], "r2");
  assert.equal(diff.toDeactivate.length, 1);
  assert.equal(diff.toDeactivate[0], "r3");
});

// ===== normalizeRolesPayload =====

test("normalize: LEADER sem facultyId => erro", () => {
  const result = normalizeRolesPayload([{ role: "LEADER" }]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Faculdade obrigat/i);
});

test("normalize: INTERN sem facultyId => erro", () => {
  const result = normalizeRolesPayload([{ role: "INTERN", baseId: BASE_X }]);
  assert.equal(result.ok, false);
});

test("normalize: PRECEPTOR sem baseId => erro", () => {
  const result = normalizeRolesPayload([{ role: "PRECEPTOR", facultyId: FACULTY_A }]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Base obrigat/i);
});

test("normalize: COORDINATOR descarta facultyId/baseId mesmo que vierem", () => {
  const result = normalizeRolesPayload([
    { role: "COORDINATOR", facultyId: FACULTY_A, baseId: BASE_X },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.roles[0].facultyId, null);
    assert.equal(result.roles[0].baseId, null);
  }
});

test("normalize: LEADER zera baseId se vier, mantem facultyId", () => {
  const result = normalizeRolesPayload([
    { role: "LEADER", facultyId: FACULTY_A, baseId: BASE_X },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.roles[0].facultyId, FACULTY_A);
    assert.equal(result.roles[0].baseId, null);
  }
});

test("normalize: duplicatas exatas sao deduplicadas", () => {
  const result = normalizeRolesPayload([
    { role: "LEADER", facultyId: FACULTY_A },
    { role: "LEADER", facultyId: FACULTY_A },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.roles.length, 1);
});

test("normalize: lista vazia => erro (usuario precisa ter ao menos 1 role)", () => {
  const result = normalizeRolesPayload([]);
  assert.equal(result.ok, false);
});

test("normalize: multi-role valido (LEADER@A + INTERN@B + PRECEPTOR@BASE_X) passa", () => {
  const result = normalizeRolesPayload([
    { role: "LEADER", facultyId: FACULTY_A },
    { role: "INTERN", facultyId: FACULTY_B },
    { role: "PRECEPTOR", baseId: BASE_X },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.roles.length, 3);
});

test("normalize: duas INTERN em faculdades diferentes nao sao deduplicadas", () => {
  const result = normalizeRolesPayload([
    { role: "INTERN", facultyId: FACULTY_A },
    { role: "INTERN", facultyId: FACULTY_B },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.roles.length, 2);
});

test("normalize: PRECEPTOR em duas bases diferentes nao sao deduplicadas", () => {
  const result = normalizeRolesPayload([
    { role: "PRECEPTOR", baseId: BASE_X },
    { role: "PRECEPTOR", baseId: BASE_Y },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.roles.length, 2);
});
