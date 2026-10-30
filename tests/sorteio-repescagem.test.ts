/**
 * Sorteio da repescagem: ordem por critério (meta abaixo > nunca teve extra >
 * já teve extra), empate pela ordem sorteada com semente pública, um lugar
 * por pessoa, faculdade que liberou não pega.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { deveSortear, distribuir, entraNoSorteio, horaDoSorteio, ordemDoSorteio, prioridadeNoTipo, type Candidato, type VagaDoSorteio } from "../src/features/extra-offers/application/sorteio-repescagem";
import { horaDoSorteioAdiado, minutosDesdeAbertura } from "../src/features/extra-offers/application/repescagem";
import { textoAnuncioSorteio } from "../src/features/dai-avisos/textos";

const zero = { USA: 0, CRU: 0, CRL: 0 };
const c = (internId: string, extra: Partial<Candidato> = {}): Candidato => ({ internId, facultyId: "fac-a", faltam: zero, jaTeveExtra: false, ...extra });
const v = (offerId: string, tipo: VagaDoSorteio["tipo"] = "USA", releasedFacultyId: string | null = "fac-z"): VagaDoSorteio => ({ offerId, baseCode: offerId, tipo, releasedFacultyId });
const sempre = async () => null;

test("prioridade: casinha vazia no tipo da vaga > nunca teve extra > já teve extra", () => {
  assert.equal(prioridadeNoTipo({ faltam: { ...zero, USA: 1 }, jaTeveExtra: true }, "USA"), 1);
  assert.equal(prioridadeNoTipo({ faltam: { ...zero, CRU: 2 }, jaTeveExtra: false }, "USA"), 2);
  assert.equal(prioridadeNoTipo({ faltam: zero, jaTeveExtra: true }, "USA"), 3);
});

test("ordem sorteada: mesma semente, mesma ordem; outra semente embaralha; ninguém some", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `u${i}`);
  const a = ordemDoSorteio("semente-1", ids);
  assert.deepEqual(ordemDoSorteio("semente-1", [...ids].reverse()), a);
  assert.deepEqual([...a].sort(), [...ids].sort());
  assert.notDeepEqual(ordemDoSorteio("semente-2", ids), a);
});

test("critério antes da sorte: quem precisa da meta leva antes de quem saiu na frente no sorteio", async () => {
  const ordem = [c("sem-extra"), c("ja-teve", { jaTeveExtra: true }), c("precisa", { faltam: { ...zero, USA: 1 } })];
  const { levou } = await distribuir(ordem, [v("A"), v("B")], sempre);
  assert.deepEqual([...levou.keys()], ["precisa", "sem-extra"]);
  assert.equal(levou.get("precisa")!.prioridade, 1);
  assert.equal(levou.has("ja-teve"), false);
});

test("empate no critério: vale a ordem sorteada; um lugar por pessoa", async () => {
  const ordem = [c("x"), c("y"), c("z")];
  const { levou } = await distribuir(ordem, [v("A"), v("B")], sempre);
  assert.deepEqual([...levou.keys()], ["x", "y"]);
  assert.notEqual(levou.get("x")!.vaga.offerId, levou.get("y")!.vaga.offerId);
});

test("já teve extra leva o que sobrar", async () => {
  const { levou } = await distribuir([c("ja", { jaTeveExtra: true })], [v("A")], sempre);
  assert.equal(levou.get("ja")?.prioridade, 3);
});

test("a faculdade que liberou não pega a própria vaga; vaga sem dono vale para todos", async () => {
  const { levou } = await distribuir([c("da-casa", { facultyId: "fac-z" })], [v("LIB", "USA", "fac-z"), v("SD", "USA", null)], sempre);
  assert.equal(levou.get("da-casa")?.vaga.offerId, "SD");
});

test("prioridade é por vaga: precisa de CRU passa à frente na CRU, não na USA", async () => {
  const ordem = [c("usa-livre"), c("precisa-cru", { faltam: { ...zero, CRU: 1 } })];
  const { levou } = await distribuir(ordem, [v("U", "USA"), v("C", "CENTRAL" as never)], sempre);
  // Tipo desconhecido não dá prioridade 1: os dois disputam no critério 2, pela ordem sorteada.
  assert.equal(levou.get("usa-livre")?.vaga.offerId, "U");
  const cru = await distribuir(ordem, [v("C", "CRU")], sempre);
  assert.deepEqual([...cru.levou.keys()], ["precisa-cru"]);
});

test("se a vaga não cabe para quem é a vez (descanso, viatura), passa ao próximo e guarda o motivo", async () => {
  const ordem = [c("cansado"), c("livre")];
  const { levou, motivos } = await distribuir(ordem, [v("A")], async (cand) => (cand.internId === "cansado" ? "sem 12h de descanso" : null));
  assert.deepEqual([...levou.keys()], ["livre"]);
  assert.equal(motivos.get("cansado"), "sem 12h de descanso");
});

test("hora do sorteio = abertura da repescagem: diurno 20h da véspera, noturno 11h do dia", () => {
  assert.deepEqual(horaDoSorteio("2026-11-09", "DAY"), { date: "2026-11-08", hour: 20 });
  assert.deepEqual(horaDoSorteio("2026-11-09", "NIGHT"), { date: "2026-11-09", hour: 11 });
});

test("anúncio: hora, turno, vagas, a ordem e onde se inscrever", () => {
  const t = textoAnuncioSorteio({ turno: "seg 09/11 dia", hora: "hoje às 20h", vagas: [{ tipo: "USA", n: 4 }], precisa: ["USA"] });
  assert.match(t, /Sorteio da repescagem \*\*hoje às 20h\*\* para \*\*seg 09\/11 dia\*\*: 4 vagas livres \(4 USA\)/);
  assert.match(t, /primeiro quem tem casinha vazia no tipo, depois quem nunca teve extra/);
  assert.match(t, /Você ainda tem USA faltando na meta/);
  assert.match(t, /Extras → Sorteios/);
});

// ---------------------------------------------------------------------------
// Só entre interessados: sem inscrito na abertura, espera 2h e anuncia de novo.

test("roda na abertura só com inscrito; sem ninguém, espera a hora adiada e então roda", () => {
  assert.equal(deveSortear(0, 3), true);
  assert.equal(deveSortear(0, 0), false);
  assert.equal(deveSortear(45, 2), false); // cron atrasado com inscrito: espera a hora adiada, que foi anunciada
  assert.equal(deveSortear(119, 0), false);
  assert.equal(deveSortear(120, 0), true);
  assert.equal(deveSortear(Infinity, 0), true);
});

test("hora adiada: 13h no noturno, 22h no diurno; minutos contados do horário de Salvador", () => {
  assert.deepEqual(horaDoSorteioAdiado("2026-10-30", "NIGHT"), { date: "2026-10-30", hour: 13 });
  assert.deepEqual(horaDoSorteioAdiado("2026-10-31", "DAY"), { date: "2026-10-30", hour: 22 });
  assert.equal(minutosDesdeAbertura("2026-10-30", "NIGHT", new Date("2026-10-30T10:59:00-03:00")), null);
  assert.equal(minutosDesdeAbertura("2026-10-30", "NIGHT", new Date("2026-10-30T11:20:00-03:00")), 20);
  assert.equal(minutosDesdeAbertura("2026-10-31", "DAY", new Date("2026-10-30T21:05:00-03:00")), 65);
});

test("anúncio do adiamento diz que ninguém se inscreveu, a nova hora e o que acontece depois", () => {
  const t = textoAnuncioSorteio({ turno: "sex 30/10 noite", hora: "hoje às 13h", vagas: [{ tipo: "USA", n: 4 }], precisa: [], adiado: true });
  assert.match(t, /Ninguém tinha se inscrito, então o sorteio da repescagem de \*\*sex 30\/10 noite\*\* foi adiado para \*\*hoje às 13h\*\*/);
  assert.match(t, /Sem inscritos até lá, vão para quem pegar primeiro/);
});

test("CRU não vai a sorteio: só troca", () => {
  assert.equal(entraNoSorteio("CRU"), false);
  assert.equal(entraNoSorteio("USA"), true);
  assert.equal(entraNoSorteio("CRL"), true);
});
