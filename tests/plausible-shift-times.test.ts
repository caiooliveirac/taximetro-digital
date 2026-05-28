import test from "node:test";
import assert from "node:assert/strict";
import { pickPlausibleShiftTimes } from "../src/features/admin-attendance/application/plausible-shift-times";

// Bahia é UTC-3 fixo. Janelas: 06:55–07:10 e 18:55–19:10 (locais).
// Em UTC essas janelas viram 09:55–10:10 e 21:55–22:10.

function rngFromList(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

function isoLocalBahia(d: Date): { date: string; hour: number; minute: number } {
  // Converte UTC -> Bahia subtraindo 3h.
  const local = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return {
    date: local.toISOString().slice(0, 10),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

test("DAY: check-in cai em 06:55–07:10 e checkout em 18:55–19:10, mesma data", () => {
  // rng = 0 → minuto inicial; depois 0 segundos; depois 0 minuto checkout; 0 segundos.
  const r = pickPlausibleShiftTimes({ date: "2026-05-20", period: "DAY", rng: rngFromList([0, 0, 0, 0]) });
  const ci = isoLocalBahia(r.checkinAt);
  const co = isoLocalBahia(r.checkoutAt);
  assert.equal(ci.date, "2026-05-20");
  assert.equal(ci.hour, 6);
  assert.equal(ci.minute, 55);
  assert.equal(co.date, "2026-05-20");
  assert.equal(co.hour, 18);
  assert.equal(co.minute, 55);
});

test("DAY: rng=0.9999 atinge o topo da janela (07:10 / 19:10)", () => {
  const r = pickPlausibleShiftTimes({ date: "2026-05-20", period: "DAY", rng: rngFromList([0.9999, 0, 0.9999, 0]) });
  const ci = isoLocalBahia(r.checkinAt);
  const co = isoLocalBahia(r.checkoutAt);
  assert.equal(ci.hour, 7);
  assert.equal(ci.minute, 10);
  assert.equal(co.hour, 19);
  assert.equal(co.minute, 10);
});

test("NIGHT: check-in na data, checkout no dia seguinte 06:55–07:10", () => {
  const r = pickPlausibleShiftTimes({ date: "2026-05-20", period: "NIGHT", rng: rngFromList([0, 0, 0.9999, 0]) });
  const ci = isoLocalBahia(r.checkinAt);
  const co = isoLocalBahia(r.checkoutAt);
  assert.equal(ci.date, "2026-05-20");
  assert.equal(ci.hour, 18);
  assert.equal(ci.minute, 55);
  assert.equal(co.date, "2026-05-21");
  assert.equal(co.hour, 7);
  assert.equal(co.minute, 10);
});

test("NIGHT na virada do mês: checkout incrementa o mês", () => {
  const r = pickPlausibleShiftTimes({ date: "2026-05-31", period: "NIGHT", rng: rngFromList([0.5, 0, 0.5, 0]) });
  const co = isoLocalBahia(r.checkoutAt);
  assert.equal(co.date, "2026-06-01");
});

test("Propriedade: checkout sempre depois do checkin com diferença ~12h ±15min", () => {
  for (let seed = 0; seed < 50; seed++) {
    const r = pickPlausibleShiftTimes({
      date: "2026-05-20",
      period: seed % 2 === 0 ? "DAY" : "NIGHT",
      rng: rngFromList([Math.sin(seed) ** 2, Math.cos(seed) ** 2, Math.sin(seed + 1) ** 2, Math.cos(seed + 1) ** 2]),
    });
    const diffMs = r.checkoutAt.getTime() - r.checkinAt.getTime();
    const diffMin = diffMs / 60000;
    assert.ok(diffMin > 11 * 60 + 30, `diff curto demais: ${diffMin}min`);
    assert.ok(diffMin < 12 * 60 + 30, `diff longo demais: ${diffMin}min`);
  }
});

test("Data inválida lança erro", () => {
  assert.throws(() => pickPlausibleShiftTimes({ date: "20/05/2026", period: "DAY" }));
});
