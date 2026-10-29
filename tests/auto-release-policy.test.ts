import test from "node:test";
import assert from "node:assert/strict";
import {
  capacidadeDaBase,
  dataDeLiberacao,
  planejarVaga,
  type FaculdadeNaVaga,
} from "../src/features/scheduling/domain/policies/auto-release-policy";

function fac(over: Partial<FaculdadeNaVaga> & { facultyId: string }): FaculdadeNaVaga {
  return { capacity: 1, blocked: false, eligible: true, assigned: 0, alreadyReleased: 0, ...over };
}

test("teto: diurno dois, BR60, BR05, PM04 e PM40 só um; noturno um, dois só na SM01, CB02, PR03 e CN10", () => {
  assert.equal(capacidadeDaBase("PP20", "DAY"), 2);
  assert.equal(capacidadeDaBase("BR60", "DAY"), 1);
  assert.equal(capacidadeDaBase("BR05", "DAY"), 1);
  assert.equal(capacidadeDaBase("BR60", "NIGHT"), 1);
  assert.equal(capacidadeDaBase("BR05", "NIGHT"), 1);
  for (const code of ["PM04", "PM40"]) {
    assert.equal(capacidadeDaBase(code, "DAY"), 1);
    assert.equal(capacidadeDaBase(code, "NIGHT"), 1);
  }
  for (const code of ["SM01", "CB02", "PR03", "CN10"]) assert.equal(capacidadeDaBase(code, "NIGHT"), 2);
  // CC70 à noite é um só: não tem cama para dois (Caio, 29/10).
  assert.equal(capacidadeDaBase("CC70", "NIGHT"), 1);
  assert.equal(capacidadeDaBase("PM40", "NIGHT"), 1);
  assert.equal(capacidadeDaBase("LF90", "DAY"), null);
});

test("prazo de 3 dias: turma de 26/10 escala 26, 27 e 28; libera em 29/10", () => {
  assert.equal(dataDeLiberacao({ cohortStart: "2026-10-26", enabledSince: "2026-10-01", deadlineDays: 3 }), "2026-10-29");
});

test("turma que começou antes do mecanismo ganha o prazo a partir de quando ligou", () => {
  assert.equal(dataDeLiberacao({ cohortStart: "2026-09-14", enabledSince: "2026-10-27", deadlineDays: 3 }), "2026-10-30");
});

test("vaga da grade não usada depois do prazo é liberada", () => {
  const plano = planejarVaga({ cap: 2, faculdades: [fac({ facultyId: "A" }), fac({ facultyId: "B", assigned: 1 })], totalAssigned: 1, openOffers: 0, semDonoExistentes: 0 });
  assert.equal(plano.porFaculdade.get("A"), 1);
  assert.equal(plano.porFaculdade.has("B"), false);
  assert.equal(plano.semDono, 0);
});

test("faculdade ainda no prazo segura a vaga dela", () => {
  const plano = planejarVaga({ cap: 2, faculdades: [fac({ facultyId: "A", eligible: false })], totalAssigned: 0, openOffers: 0, semDonoExistentes: 0 });
  assert.equal(plano.porFaculdade.size, 0);
  // A segunda vaga da base não é de ninguém: fica livre.
  assert.equal(plano.semDono, 1);
});

test("noturno de base com dois internos: a segunda vaga, sem dono, fica livre", () => {
  const plano = planejarVaga({ cap: 2, faculdades: [fac({ facultyId: "A", assigned: 1 })], totalAssigned: 1, openOffers: 0, semDonoExistentes: 0 });
  assert.equal(plano.semDono, 1);
});

test("BR05 com duas faculdades na grade e teto um: só uma vaga sai, a segunda fica travada", () => {
  const plano = planejarVaga({ cap: 1, faculdades: [fac({ facultyId: "A" }), fac({ facultyId: "B" })], totalAssigned: 0, openOffers: 0, semDonoExistentes: 0 });
  const total = [...plano.porFaculdade.values()].reduce((n, v) => n + v, 0) + plano.semDono;
  assert.equal(total, 1);
});

test("BR05 com um interno escalado: nada sai", () => {
  const plano = planejarVaga({ cap: 1, faculdades: [fac({ facultyId: "A", assigned: 1 }), fac({ facultyId: "B" })], totalAssigned: 1, openOffers: 0, semDonoExistentes: 0 });
  assert.equal(plano.porFaculdade.size, 0);
  assert.equal(plano.semDono, 0);
});

test("liberação já feita (ou desfeita pelo líder) não se repete", () => {
  const plano = planejarVaga({ cap: 2, faculdades: [fac({ facultyId: "A", alreadyReleased: 1 })], totalAssigned: 0, openOffers: 1, semDonoExistentes: 1 });
  assert.equal(plano.porFaculdade.size, 0);
  assert.equal(plano.semDono, 0);
});

test("regra bloqueada nunca libera", () => {
  const plano = planejarVaga({ cap: 1, faculdades: [fac({ facultyId: "A", blocked: true })], totalAssigned: 0, openOffers: 0, semDonoExistentes: 0 });
  assert.equal(plano.porFaculdade.size, 0);
  assert.equal(plano.semDono, 0);
});

test("base fora da tabela (LF90) não ganha vaga sem dono", () => {
  const plano = planejarVaga({ cap: null, faculdades: [fac({ facultyId: "A", capacity: 2, eligible: false })], totalAssigned: 0, openOffers: 0, semDonoExistentes: 0 });
  assert.equal(plano.semDono, 0);
});

test("extra escalado além da grade ocupa o espaço da vaga sem dono", () => {
  const plano = planejarVaga({ cap: 2, faculdades: [fac({ facultyId: "A", assigned: 1 })], totalAssigned: 2, openOffers: 0, semDonoExistentes: 0 });
  assert.equal(plano.semDono, 0);
});

test("aviso no Telegram: sem dono e prazo dizem de onde veio a vaga e quem escalou", async () => {
  const { textoVagaAutomaticaUsada } = await import("../src/features/extra-offers/application/use-cases/claim-extra-offer");
  const base = { baseCode: "PR03", date: "2026-11-03", period: "NIGHT", internName: "Fulano", facultyAbbr: "UFBA", actorName: "Líder X", actorRole: "LEADER" };
  const semDono = textoVagaAutomaticaUsada({ ...base, autoRelease: "SEM_DONO", releasedByAbbr: null });
  assert.match(semDono, /Vaga sem dono usada/);
  assert.match(semDono, /PR03 · 03\/11 noturno/);
  assert.match(semDono, /Escalado por: Líder X \(líder UFBA\)/);
  const prazo = textoVagaAutomaticaUsada({ ...base, autoRelease: "PRAZO", releasedByAbbr: "EBMSP", actorRole: "COORDINATOR" });
  assert.match(prazo, /prazo da EBMSP/);
  assert.match(prazo, /\(coordenação\)/);
});
