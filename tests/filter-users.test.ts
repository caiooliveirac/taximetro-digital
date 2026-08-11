import { test } from "node:test";
import assert from "node:assert/strict";
import { filterUsers, countActiveFilters, EMPTY_FILTERS, type UserFilters } from "../src/app/admin/usuarios/filter-users";

function makeUser(over: Record<string, unknown> = {}) {
  return {
    name: "Ana Silva",
    cpf: "111.222.333-44",
    email: "ana@dev.local",
    phone: null,
    registrationCode: null,
    isActive: true,
    isArchived: false,
    role: "INTERN",
    facultyId: "f1",
    facultyAbbr: "UNI",
    baseCode: null,
    createdAt: "2026-01-10T00:00:00.000Z",
    allRoles: [{ role: "INTERN", facultyId: "f1", cohortId: "c1" }],
    ...over,
  };
}

const users = [
  makeUser(),
  makeUser({ name: "Bruno Costa", email: "bruno@dev.local", isActive: false, createdAt: "2026-03-01T00:00:00.000Z" }),
  makeUser({ name: "Carla Dias", email: "carla@dev.local", isArchived: true, facultyId: "f2", allRoles: [{ role: "INTERN", facultyId: "f2", cohortId: "c2" }], createdAt: "2026-02-01T00:00:00.000Z" }),
  makeUser({ name: "Davi Souza", email: "davi@dev.local", role: "PRECEPTOR", facultyId: null, allRoles: [{ role: "PRECEPTOR", facultyId: null, cohortId: null }] }),
];

function f(over: Partial<UserFilters>): UserFilters {
  return { ...EMPTY_FILTERS, ...over };
}

test("sem filtro retorna todos, ordenado por nome", () => {
  const out = filterUsers(users, EMPTY_FILTERS);
  assert.equal(out.length, 4);
  assert.deepEqual(out.map((u) => u.name), ["Ana Silva", "Bruno Costa", "Carla Dias", "Davi Souza"]);
});

test("status: ativo exclui pendente e arquivado", () => {
  const out = filterUsers(users, f({ status: "active" }));
  assert.deepEqual(out.map((u) => u.name), ["Ana Silva", "Davi Souza"]);
});

test("status: pendente e arquivado", () => {
  assert.deepEqual(filterUsers(users, f({ status: "pending" })).map((u) => u.name), ["Bruno Costa"]);
  assert.deepEqual(filterUsers(users, f({ status: "archived" })).map((u) => u.name), ["Carla Dias"]);
});

test("faculdade e turma via allRoles", () => {
  assert.deepEqual(filterUsers(users, f({ fac: "f2" })).map((u) => u.name), ["Carla Dias"]);
  assert.deepEqual(filterUsers(users, f({ turma: "c1" })).map((u) => u.name), ["Ana Silva", "Bruno Costa"]);
});

test("papel + busca combinados", () => {
  assert.deepEqual(filterUsers(users, f({ papel: "PRECEPTOR" })).map((u) => u.name), ["Davi Souza"]);
  assert.deepEqual(filterUsers(users, f({ papel: "INTERN", q: "bruno" })).map((u) => u.name), ["Bruno Costa"]);
});

test("ordenação por data de cadastro", () => {
  const newest = filterUsers(users, f({ sort: "newest" }));
  assert.equal(newest[0].name, "Bruno Costa");
  const oldest = filterUsers(users, f({ sort: "oldest" }));
  assert.equal(oldest[0].name, "Ana Silva");
});

test("countActiveFilters ignora q e sort", () => {
  assert.equal(countActiveFilters(f({ status: "active", fac: "f1", q: "x", sort: "newest" })), 2);
  assert.equal(countActiveFilters(EMPTY_FILTERS), 0);
});
