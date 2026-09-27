import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_ABSENCE_CHECKOUT_NOTE,
  classifyPendingAttendance,
  isAutoAbsenceAfterCheckin,
  isRetroactiveCheckout,
} from "../src/shared/domain/policies/pending-attendance";

function sp(dateStr: string, hour: number, minute = 0): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour + 3, minute));
}

const base = {
  status: "SCHEDULED",
  isExtraShift: false,
  checkinStatus: null as string | null,
  totpValidatedAt: null as Date | null,
  checkoutAt: null as Date | null,
  checkoutNotes: null as string | null,
};

const sweptAfterCheckin = {
  ...base,
  status: "ABSENT",
  checkinStatus: "REJECTED",
  totpValidatedAt: new Date("2026-09-21T10:00:00Z"),
  checkoutNotes: AUTO_ABSENCE_CHECKOUT_NOTE,
};

test("fez check-in e o sweep virou falta: é checkout pendente", () => {
  assert.equal(isAutoAbsenceAfterCheckin(sweptAfterCheckin), true);
  assert.equal(classifyPendingAttendance(sweptAfterCheckin), "CHECKOUT");
});

test("falta lançada à mão não reabre como checkout", () => {
  const manual = { ...sweptAfterCheckin, totpValidatedAt: null, checkoutNotes: "Falta registrada manualmente pelo admin" };
  assert.equal(isAutoAbsenceAfterCheckin(manual), false);
  assert.equal(classifyPendingAttendance(manual), "CHECKIN");
});

test("check-in pendente (nunca validado) que o sweep rejeitou é falta sem check-in", () => {
  const pendingSwept = { ...sweptAfterCheckin, totpValidatedAt: null };
  assert.equal(classifyPendingAttendance(pendingSwept), "CHECKIN");
});

test("em check-in: checkout pendente", () => {
  assert.equal(classifyPendingAttendance({ ...base, status: "CHECKED_IN", checkinStatus: "VALIDATED" }), "CHECKOUT");
});

test("resolvidos não aparecem", () => {
  for (const status of ["CHECKED_OUT", "CANCELLED", "EXCUSED"]) {
    assert.equal(classifyPendingAttendance({ ...base, status }), null, status);
  }
});

test("sem check-in aparece; extra nunca reivindicado não", () => {
  assert.equal(classifyPendingAttendance(base), "CHECKIN");
  assert.equal(classifyPendingAttendance({ ...base, status: "ABSENT" }), "CHECKIN");
  assert.equal(classifyPendingAttendance({ ...base, isExtraShift: true }), null);
  assert.equal(classifyPendingAttendance({ ...base, isExtraShift: true, status: "CHECKED_IN" }), "CHECKOUT");
});

test("checkout retroativo só fora da janela do turno", () => {
  const d = { date: "2026-09-21", period: "DAY" as const, shift: null };
  assert.equal(isRetroactiveCheckout(d, sp("2026-09-21", 18)), false);
  assert.equal(isRetroactiveCheckout(d, sp("2026-09-27", 10)), true);
  // noturno de ontem fechado de manhã é checkout na hora, não retroativo
  const n = { date: "2026-09-26", period: "NIGHT" as const, shift: null };
  assert.equal(isRetroactiveCheckout(n, sp("2026-09-27", 7)), false);
  assert.equal(isRetroactiveCheckout(n, sp("2026-09-27", 13)), true);
});
