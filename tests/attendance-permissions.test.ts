import test from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import {
  canConfirmCheckout,
  canStartCheckin,
  canValidateCheckin,
} from "../src/lib/attendance-permissions";

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

test("check-in: LEADER+INTERN consegue iniciar (sem impersonation)", () => {
  const token = fakeToken(["LEADER", "INTERN"]);
  assert.equal(canStartCheckin(token, false), true);
});

test("check-in: LEADER puro nao consegue iniciar (sem impersonation)", () => {
  const token = fakeToken(["LEADER"]);
  assert.equal(canStartCheckin(token, false), false);
});

test("check-in: coordinator impersonando sempre consegue", () => {
  const token = fakeToken(["COORDINATOR"]);
  assert.equal(canStartCheckin(token, true), true);
});

test("validate: PRECEPTOR+LEADER consegue validar", () => {
  const session = fakeSession(["PRECEPTOR", "LEADER"]);
  assert.equal(canValidateCheckin(session), true);
});

test("validate: INTERN+LEADER nao consegue validar", () => {
  const session = fakeSession(["INTERN", "LEADER"]);
  assert.equal(canValidateCheckin(session), false);
});

test("checkout confirm: COORDINATOR+INTERN consegue confirmar", () => {
  const session = fakeSession(["COORDINATOR", "INTERN"]);
  assert.equal(canConfirmCheckout(session), true);
});

test("checkout confirm: LEADER+INTERN nao consegue confirmar", () => {
  const session = fakeSession(["LEADER", "INTERN"]);
  assert.equal(canConfirmCheckout(session), false);
});

test("guards fail-closed com session/token ausentes", () => {
  assert.equal(canStartCheckin(null, false), false);
  assert.equal(canValidateCheckin(undefined), false);
  assert.equal(canConfirmCheckout(null), false);
});
