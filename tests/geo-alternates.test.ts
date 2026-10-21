import test from "node:test";
import assert from "node:assert/strict";
import { checkGeofenceWithAlternates } from "../src/lib/geo";

const cru = { code: "CRU", latitude: -12.959059, longitude: -38.487843, geoFenceMeters: 200 };
const fac = { code: "FACULDADE", latitude: -12.960612, longitude: -38.431644, geoFenceMeters: 200 };

test("no raio da FACULDADE valida para plantão no CRU", () => {
  const r = checkGeofenceWithAlternates(fac.latitude, fac.longitude, cru, [fac]);
  assert.equal(r.valid, true);
  assert.equal(r.matchedBaseCode, "FACULDADE");
});

test("no raio do próprio CRU continua valendo", () => {
  const r = checkGeofenceWithAlternates(cru.latitude, cru.longitude, cru, [fac]);
  assert.equal(r.valid, true);
  assert.equal(r.matchedBaseCode, "CRU");
});

test("fora das duas cercas não valida", () => {
  const r = checkGeofenceWithAlternates(-12.9, -38.4, cru, [fac]);
  assert.equal(r.valid, false);
});

test("sem alternativas, só a base do plantão conta", () => {
  const r = checkGeofenceWithAlternates(fac.latitude, fac.longitude, cru, []);
  assert.equal(r.valid, false);
});

test("com várias alternativas, vale a que acerta (ADAB)", () => {
  const adab = { code: "ADAB", latitude: -12.9908276, longitude: -38.4886242, geoFenceMeters: 300 };
  const r = checkGeofenceWithAlternates(adab.latitude, adab.longitude, cru, [fac, adab]);
  assert.equal(r.valid, true);
  assert.equal(r.matchedBaseCode, "ADAB");
});

test("alternativa só para CRU e só para a faculdade certa", async () => {
  const { alternateBaseCodes } = await import("../src/lib/geo");
  assert.deepEqual(alternateBaseCodes("CRU", "ZARNS"), ["FACULDADE"]);
  assert.deepEqual(alternateBaseCodes("CRU", "unifacs"), ["FACULDADE"]);
  assert.deepEqual(alternateBaseCodes("CRU", "EBMSP"), ["ADAB"]);
  assert.deepEqual(alternateBaseCodes("CRU", "UFBA"), []);
  assert.deepEqual(alternateBaseCodes("CRU", null), []);
  assert.deepEqual(alternateBaseCodes("SM01", "EBMSP"), []);
  assert.deepEqual(alternateBaseCodes("CRL", "ZARNS"), []);
});
