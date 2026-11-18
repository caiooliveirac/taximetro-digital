import test from "node:test";
import assert from "node:assert/strict";
import { motivoParaNaoMudar } from "../src/features/scheduling/application/use-cases/mudar-de-base-do-interno";

const meu = { baseId: "cb02", facultyId: "fac-a", date: "2026-11-25", period: "DAY", tipo: "USA" };
const vaga = (o: Partial<Parameters<typeof motivoParaNaoMudar>[1]> = {}) => ({
  baseId: "pm40", date: "2026-11-25", period: "DAY", tipo: "USA", releasedFacultyId: "fac-b", autoRelease: null, ...o,
});

test("mudar de base: vaga livre do mesmo dia, turno e tipo serve", () => {
  assert.equal(motivoParaNaoMudar(meu, vaga()), null);
  assert.equal(motivoParaNaoMudar(meu, vaga({ releasedFacultyId: null, autoRelease: "SEM_DONO" })), null);
  // Liberada por interno ou levada à repescagem: vale também para a faculdade dona.
  assert.equal(motivoParaNaoMudar(meu, vaga({ releasedFacultyId: "fac-a", autoRelease: "INTERNO" })), null);
});

test("mudar de base: outro dia, turno, tipo, mesma base, extra ou liberada pelo próprio líder não serve", () => {
  assert.match(motivoParaNaoMudar(meu, vaga({ date: "2026-11-26" }))!, /outro dia ou turno/);
  assert.match(motivoParaNaoMudar(meu, vaga({ period: "NIGHT" }))!, /outro dia ou turno/);
  assert.match(motivoParaNaoMudar(meu, vaga({ tipo: "CRL" }))!, /USA por USA/);
  assert.match(motivoParaNaoMudar(meu, vaga({ baseId: "cb02" }))!, /mesma base/);
  assert.match(motivoParaNaoMudar(meu, vaga({ releasedFacultyId: null }))!, /extra/);
  assert.match(motivoParaNaoMudar(meu, vaga({ releasedFacultyId: "fac-a" }))!, /sua faculdade/);
});
