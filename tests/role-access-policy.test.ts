import test from "node:test";
import assert from "node:assert/strict";
import { canAccessPathWithRoles, extractRoleNames } from "../src/lib/role-access-policy";

test("extractRoleNames aceita mix string + objeto e ignora invalidos", () => {
  const roles = extractRoleNames([
    "LEADER",
    { role: "INTERN", facultyId: "fac-1" },
    "INVALID",
    { role: "NOPE" },
  ], "LEADER");

  assert.deepEqual(roles.sort(), ["INTERN", "LEADER"]);
});

test("extractRoleNames usa fallback primaryRole quando roles[] vazia", () => {
  const roles = extractRoleNames(undefined, "PRECEPTOR");
  assert.deepEqual(roles, ["PRECEPTOR"]);
});

test("multi-role: LEADER+INTERN pode acessar /leader e /intern", () => {
  const roles = extractRoleNames(["LEADER", "INTERN"], "LEADER");
  assert.equal(canAccessPathWithRoles("/leader", "LEADER", roles), true);
  assert.equal(canAccessPathWithRoles("/intern/checkin", "LEADER", roles), true);
});

test("LEADER sem PRECEPTOR nao acessa /preceptor", () => {
  const roles = extractRoleNames(["LEADER", "INTERN"], "LEADER");
  assert.equal(canAccessPathWithRoles("/preceptor", "LEADER", roles), false);
});

test("LEADER+PRECEPTOR pode acessar /preceptor", () => {
  const roles = extractRoleNames(["LEADER", "PRECEPTOR"], "LEADER");
  assert.equal(canAccessPathWithRoles("/preceptor", "LEADER", roles), true);
});

test("COORDINATOR pode acessar qualquer area", () => {
  const roles = extractRoleNames(["COORDINATOR"], "COORDINATOR");
  assert.equal(canAccessPathWithRoles("/intern/checkin", "COORDINATOR", roles), true);
  assert.equal(canAccessPathWithRoles("/leader", "COORDINATOR", roles), true);
});

test("role principal desconhecida nao bloqueia (preserva semantica atual)", () => {
  assert.equal(canAccessPathWithRoles("/qualquer", undefined, []), true);
  assert.equal(canAccessPathWithRoles("/qualquer", "UNKNOWN", []), true);
});
