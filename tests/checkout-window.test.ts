import test from "node:test";
import assert from "node:assert/strict";
import { isWithinShiftCheckoutWindow } from "../src/lib/utils";

// America/Sao_Paulo é UTC-3 fixo (sem horário de verão). Um horário LOCAL L
// no dia D corresponde ao instante UTC L+3. Este helper monta o Date do
// "agora" a partir de um horário local de São Paulo.
function sp(dateStr: string, hour: number, minute = 0): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour + 3, minute));
}

const D = "2026-07-15"; // dia do plantão
const NEXT = "2026-07-16";

test("diurno completo: checkout abre 11:00 e fecha 00:00 do dia seguinte", () => {
  assert.equal(isWithinShiftCheckoutWindow(D, "DAY", null, sp(D, 10, 59)), false);
  assert.equal(isWithinShiftCheckoutWindow(D, "DAY", null, sp(D, 11, 0)), true);
  assert.equal(isWithinShiftCheckoutWindow(D, "DAY", null, sp(D, 15, 0)), true); // antes abria só aqui
  assert.equal(isWithinShiftCheckoutWindow(D, "DAY", null, sp(D, 23, 30)), true);
  assert.equal(isWithinShiftCheckoutWindow(D, "DAY", null, sp(NEXT, 0, 0)), true);
  assert.equal(isWithinShiftCheckoutWindow(D, "DAY", null, sp(NEXT, 0, 1)), false);
});

test("noturno: checkout abre 23:00 do MESMO dia e fecha 12:00 do dia seguinte", () => {
  assert.equal(isWithinShiftCheckoutWindow(D, "NIGHT", null, sp(D, 22, 59)), false);
  assert.equal(isWithinShiftCheckoutWindow(D, "NIGHT", null, sp(D, 23, 0)), true);
  assert.equal(isWithinShiftCheckoutWindow(D, "NIGHT", null, sp(NEXT, 6, 0)), true); // continua liberado
  assert.equal(isWithinShiftCheckoutWindow(D, "NIGHT", null, sp(NEXT, 12, 0)), true);
  assert.equal(isWithinShiftCheckoutWindow(D, "NIGHT", null, sp(NEXT, 12, 1)), false);
});

test("EBMSP manhã: checkout abre 11:00", () => {
  assert.equal(isWithinShiftCheckoutWindow(D, "DAY", "MORNING", sp(D, 10, 59)), false);
  assert.equal(isWithinShiftCheckoutWindow(D, "DAY", "MORNING", sp(D, 11, 0)), true);
  assert.equal(isWithinShiftCheckoutWindow(D, "DAY", "MORNING", sp(NEXT, 0, 0)), true);
});

test("EBMSP tarde: checkout abre 17:00 (4h após início às 13:00)", () => {
  assert.equal(isWithinShiftCheckoutWindow(D, "DAY", "AFTERNOON", sp(D, 11, 0)), false);
  assert.equal(isWithinShiftCheckoutWindow(D, "DAY", "AFTERNOON", sp(D, 16, 59)), false);
  assert.equal(isWithinShiftCheckoutWindow(D, "DAY", "AFTERNOON", sp(D, 17, 0)), true);
  assert.equal(isWithinShiftCheckoutWindow(D, "DAY", "AFTERNOON", sp(D, 23, 0)), true);
});
