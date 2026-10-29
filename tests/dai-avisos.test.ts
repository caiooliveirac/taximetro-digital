/**
 * Avisos que a Dai deixa no chat: texto pronto, sem modelo. Confere o texto,
 * a escolha do tema e quem recebe aviso de vaga (só quem precisa, cabe na
 * agenda e no rodízio, sem repetir).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { temaParaPlantao, textoProximoPlantao, textoSobraParaLider, textoVagasAbertas } from "../src/features/dai-avisos/textos";
import { vagasParaCadaInterno } from "../src/features/dai-avisos/avisos";
import { cabeNaBase } from "../src/features/extra-offers/application/lotacao";

const ler = (arquivo: string) => readFileSync(path.join(process.cwd(), arquivo), "utf8");

test("véspera do plantão: base, aba Bases e um tema para revisar", () => {
  const t = textoProximoPlantao({ quando: "sex 30/10 noite", baseCode: "CB02", tipo: "USA", tema: "TRAUMA" });
  assert.match(t, /Amanhã você está na CB02 \(USA\), sex 30\/10 noite\./);
  assert.match(t, /aba Bases/);
  assert.match(t, /revise Trauma\. Na Dai, toque em "Discutir um caso"/);
});

test("tema: o primeiro do tipo que o interno não viu; regulação começa por IAM", () => {
  assert.equal(temaParaPlantao("USA", [], "2026-10-30"), "TRAUMA");
  assert.equal(temaParaPlantao("USA", ["TRAUMA", "PCR"], "2026-10-30"), "AVC");
  assert.equal(temaParaPlantao("CRU", [], "2026-10-30"), "IAM");
  // Viu tudo: gira pelo dia, sem quebrar.
  const todos = ["TRAUMA", "PCR", "AVC", "IAM", "CONVULSAO", "PSIQ", "CHOQUE", "SEPSE", "ANAFILAXIA", "ASMA", "HDA", "DPOC", "TEP"];
  assert.ok(todos.includes(temaParaPlantao("USA", todos, "2026-10-30")));
});

test("líder: turnos sem escala por tipo, quem precisa e vagas de outras; nada a dizer = sem mensagem", () => {
  const t = textoSobraParaLider({ faculdade: "EBMSP", sobraPorTipo: { USA: 40, CRU: 60, CRL: 16 }, internosPrecisando: 12, vagasDeOutras: 5 })!;
  assert.match(t, /A grade da EBMSP tem 116 turnos sem ninguém escalado \(40 USA, 60 CRU, 16 CRL\)/);
  assert.match(t, /12 internos da EBMSP ainda têm casinha vazia/);
  assert.match(t, /5 vagas liberadas por outras faculdades/);
  assert.match(t, /USA não escalada no prazo vira vaga livre/);
  assert.equal(textoSobraParaLider({ faculdade: "X", sobraPorTipo: {}, internosPrecisando: 3, vagasDeOutras: 0 }), null);
  assert.doesNotMatch(textoSobraParaLider({ faculdade: "X", sobraPorTipo: { CRU: 2 }, internosPrecisando: 0, vagasDeOutras: 0 })!, /vira vaga livre/);
});

const vaga = (id: string, tipo: "USA" | "CRU" | "CRL", date: string, period: "DAY" | "NIGHT", releasedFacultyId: string | null = "fac-b") =>
  ({ id, baseCode: id, tipo, date, period, shift: null, releasedFacultyId, liberadaPor: releasedFacultyId ? "FAC-B" : null });
const interno = (userId: string, faltam: { USA: number; CRU: number; CRL: number }, facultyId = "fac-a") =>
  ({ userId, facultyId, inicio: "2026-10-01", fim: "2026-11-15", faltam });

test("vaga aberta: só para quem precisa do tipo, cabe no rodízio e na agenda, e nunca repetida", () => {
  const vagas = [
    vaga("V1", "USA", "2026-10-31", "NIGHT"),
    vaga("V2", "USA", "2026-11-20", "DAY"), // depois do rodízio
    vaga("V3", "CRU", "2026-11-02", "DAY"),
    vaga("V4", "USA", "2026-11-01", "DAY", "fac-a"), // a própria faculdade liberou
    vaga("V5", "USA", "2026-11-03", "DAY"),
  ];
  const turnos = new Map([["ana", [{ date: "2026-10-31", period: "DAY" as const, baseCode: "CB02" }]]]);
  const r = vagasParaCadaInterno(
    vagas,
    [interno("ana", { USA: 2, CRU: 0, CRL: 0 }), interno("bia", { USA: 0, CRU: 0, CRL: 1 }), interno("caio", { USA: 1, CRU: 1, CRL: 0 })],
    turnos,
    new Map([["caio", new Set(["V1"])]]),
    "2026-10-29",
  );
  // Ana: V1 colada no plantão de sábado de dia; V2 fora do rodízio; V4 da própria faculdade.
  assert.deepEqual(r.get("ana")?.map((v) => v.id), ["V5"]);
  // Bia só precisa de CRL: nada.
  assert.equal(r.has("bia"), false);
  // Caio já foi avisado da V1.
  assert.deepEqual(r.get("caio")?.map((v) => v.id), ["V3", "V5"]);
});

test("todos que precisam recebem, e as vagas se espalham: os mais urgentes escolhem primeiro", () => {
  const vagas = [vaga("V1", "USA", "2026-11-03", "DAY"), vaga("V2", "USA", "2026-11-04", "DAY"), vaga("V3", "USA", "2026-11-05", "DAY"), vaga("V4", "USA", "2026-11-06", "DAY")];
  const internos = Array.from({ length: 10 }, (_, n) => interno(`i${n}`, { USA: n + 1, CRU: 0, CRL: 0 }));
  const r = vagasParaCadaInterno(vagas, internos, new Map(), new Map(), "2026-10-29");
  assert.equal(r.size, 10);
  assert.deepEqual(r.get("i9")!.map((v) => v.id), ["V1", "V2", "V3"]);
  assert.deepEqual(r.get("i8")!.map((v) => v.id), ["V1", "V2", "V4"]); // V4 ainda não citada entra
});

test("teto da viatura: BR60/BR05/PM04/PM40 um de dia; à noite dois só nas bases duplas; CRU sem teto", () => {
  const t = (baseCode: string, period: "DAY" | "NIGHT", tipo: "USA" | "CRU" = "USA") => ({ baseCode, period, tipo, date: "2026-11-03" });
  assert.equal(cabeNaBase(t("PM40", "DAY"), 1), false);
  assert.equal(cabeNaBase(t("BR05", "DAY"), 0), true);
  assert.equal(cabeNaBase(t("CB05", "DAY"), 1), true);
  assert.equal(cabeNaBase(t("CB05", "DAY"), 2), false);
  assert.equal(cabeNaBase(t("SM01", "NIGHT"), 1), true);
  assert.equal(cabeNaBase(t("CZ50", "NIGHT"), 1), false);
  assert.equal(cabeNaBase(t("CENTRAL", "DAY", "CRU"), 9), true);
});

test("texto de vaga: diz que falta o tipo e manda pedir ao líder pela Dai", () => {
  const t = textoVagasAbertas([{ baseCode: "CB05", quando: "qui 05/11 noite", tipo: "USA", liberadaPor: "UFBA" }, { baseCode: "CZ50", quando: "sáb 31/10 noite", tipo: "USA", liberadaPor: null }]);
  assert.match(t, /ainda falta USA na sua meta/);
  assert.match(t, /- CB05 qui 05\/11 noite \(USA, liberada pela UFBA\)/);
  assert.match(t, /- CZ50 sáb 31\/10 noite \(USA, sem dono\)/);
  assert.match(t, /Quem escala é o líder/);
});

test("a Dai não loga, não recebe mensagem e só a SAMU tem os avisos", () => {
  const remetente = ler("src/features/dai-avisos/remetente.ts");
  assert.match(remetente, /isActive: false/);
  assert.match(ler("src/app/api/intern/mensagens/route.ts"), /if \(para === \(await idDaDai\(\)\)\) return NextResponse\.json\(\{ success: false/);
  assert.match(ler("src/app/api/cron/dai-avisos/route.ts"), /if \(!temFeature\("avisosDaDai"\)\)/);
});
