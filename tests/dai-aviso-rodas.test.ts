/**
 * Aviso de rodas (troca a três) da Dai: a mesma roda nunca vai duas vezes,
 * ninguém recebe duas na mesma rodada, e quem recebeu há pouco espera.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rodasParaAvisar } from "../src/features/dai-avisos/avisos";
import { textoRodaSugerida, textoRodaProposta } from "../src/features/dai-avisos/textos";
import { montarRoda, type RodaSugerida } from "../src/shared/domain/policies/swap-cycle-policy";
import type { PlantaoDoMercado } from "../src/shared/domain/policies/swap-match-policy";

const P = (id: string, internId: string): PlantaoDoMercado => ({
  id, internId, facultyId: "f", date: "2026-11-10", period: "DAY", shift: null,
  baseCode: "PP20", baseName: "Base Periperi", baseType: "USA", status: "SCHEDULED", isExtraShift: false,
});
const roda = (ids: [string, string, string], quem: [string, string, string], sinalizadas = 2): RodaSugerida => ({
  pernas: montarRoda(ids.map((id, i) => P(id, quem[i]))),
  sinalizadas,
  assinatura: [...ids].sort().join(":"),
});

test("cada pessoa entra em uma roda por rodada, e a melhor (primeira) ganha", () => {
  const r1 = roda(["a", "b", "c"], ["ana", "bruno", "carla"], 3);
  const r2 = roda(["d", "e", "f"], ["ana", "davi", "elisa"]);
  const r3 = roda(["g", "h", "i"], ["fabio", "gabi", "heitor"]);
  assert.deepEqual(rodasParaAvisar([r1, r2, r3], new Set(), new Set()).map((r) => r.assinatura), [r1.assinatura, r3.assinatura]);
});

test("roda já avisada não volta; quem recebeu há pouco segura a roda inteira", () => {
  const r1 = roda(["a", "b", "c"], ["ana", "bruno", "carla"]);
  assert.equal(rodasParaAvisar([r1], new Set([r1.assinatura]), new Set()).length, 0);
  assert.equal(rodasParaAvisar([r1], new Set(), new Set(["carla"])).length, 0);
});

test("texto da sugestão: o que cada um entrega, e o pedido a quem não marcou", () => {
  const eu = { quem: "Ana", entrega: "Cabula, ter 10/11 dia", recebe: "Itapoã, qua 18/11 noite", deQuem: "Carla", paraQuem: "Bruno", pediu: false };
  const outros = [
    { quem: "Bruno", entrega: "Paralela, sáb 14/11 dia", recebe: "Cabula, ter 10/11 dia", deQuem: "Ana", paraQuem: "Carla" },
    { quem: "Carla", entrega: "Itapoã, qua 18/11 noite", recebe: "Paralela, sáb 14/11 dia", deQuem: "Bruno", paraQuem: "Ana" },
  ];
  const t = textoRodaSugerida(eu, outros);
  assert.match(t, /^Achei uma troca a três que tira você, Bruno e Carla/);
  assert.match(t, /- Você entrega Cabula, ter 10\/11 dia para Bruno e recebe Itapoã, qua 18\/11 noite, de Carla\./);
  assert.match(t, /- Bruno entrega Paralela, sáb 14\/11 dia para Carla\./);
  assert.match(t, /Você não marcou Itapoã, qua 18\/11 noite; se topar, a roda fecha\./);
  assert.match(t, /Só vale quando os três confirmarem/);
  assert.match(textoRodaProposta("Ana", outros[0]), /^Ana propôs uma troca a três com você:/);
});

test("a rota só envia aviso de rodas com a feature ligada; o teste (?dry=1) sempre roda", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/api/cron/dai-avisos/route.ts"), "utf8");
  assert.match(src, /tipo === "rodas" && !dry && !temFeature\("avisoDeRodas"\)/);
});
