/**
 * Aviso de trocas da Dai: quem marcou Quero/Posso recebe as ofertas que
 * consegue fechar naquele turno, sem repetir, no máximo uma vez por dia — e
 * nada sai enquanto a feature estiver desligada.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { trocasParaCadaInterno } from "../src/features/dai-avisos/avisos";
import { textoTrocasNosTurnosMarcados } from "../src/features/dai-avisos/textos";
import type { ContextoDoMercado, OfertaAberta, PlantaoDoMercado, SinalDoMercado } from "../src/shared/domain/policies/swap-match-policy";

const ler = (arquivo: string) => readFileSync(path.join(process.cwd(), arquivo), "utf8");

function P(id: string, internId: string, date: string, period: "DAY" | "NIGHT", extra: Partial<PlantaoDoMercado> = {}): PlantaoDoMercado {
  return { id, internId, facultyId: "fac", date, period, shift: null, baseCode: "PP20", baseName: "Base Periperi", baseType: "USA", status: "SCHEDULED", isExtraShift: false, ...extra };
}

const anaNoite = P("ana-sn", "ana", "2026-11-11", "NIGHT");
const brunoDia = P("bruno-sd", "bruno", "2026-11-08", "DAY", { baseName: "Base Centenário", baseCode: "CN10" });
const oferta: OfertaAberta = { requestId: "r1", plantao: brunoDia, nome: "Bruno Fictício", facultyAbbr: null, criadaEm: "2026-11-01" };

function foto(sinais: SinalDoMercado[]) {
  const ctx: ContextoDoMercado = {
    agora: new Date("2026-11-01T12:00:00-03:00"),
    plantoes: [anaNoite, brunoDia],
    sinais,
    bloqueados: new Set(),
    cotaCruUsada: new Set(),
    nomes: new Map(),
  };
  return { ctx, ofertas: [oferta], faculdadeDe: new Map([["ana", new Set(["fac"])]]), hoje: "2026-11-01" };
}

const anaQuer: SinalDoMercado = { internId: "ana", date: "2026-11-08", period: "DAY", signal: "QUERO" };

test("quem marcou Quero no turno da oferta e consegue fechar recebe", () => {
  const m = trocasParaCadaInterno(foto([anaQuer]), new Map(), new Set());
  assert.deepEqual([...m.keys()], ["ana"]);
  assert.equal(m.get("ana")![0].avaliacao.entregar?.id, "ana-sn");
});

test("não repete oferta já avisada nem avisa duas vezes no mesmo dia", () => {
  assert.equal(trocasParaCadaInterno(foto([anaQuer]), new Map([["ana", new Set(["r1"])]]), new Set()).size, 0);
  assert.equal(trocasParaCadaInterno(foto([anaQuer]), new Map(), new Set(["ana"])).size, 0);
});

test("sem marcação no turno, ou marcando outro serviço, ninguém recebe", () => {
  assert.equal(trocasParaCadaInterno(foto([]), new Map(), new Set()).size, 0);
  const outro: SinalDoMercado = { ...anaQuer, signal: "OUTRO_SERVICO" };
  assert.equal(trocasParaCadaInterno(foto([outro]), new Map(), new Set()).size, 0);
});

test("texto: lugar, quando, quem, o que daria e como propor", () => {
  const t = textoTrocasNosTurnosMarcados([{ base: "Centenário", quando: "dom 08/11 dia", quem: "Bruno", perfeita: true, dar: "Periperi, qua 11/11 noite" }]);
  assert.match(t, /^Apareceu uma oferta de troca num turno que você marcou no calendário:/);
  assert.match(t, /- Centenário, dom 08\/11 dia, de Bruno\. Você daria Periperi, qua 11\/11 noite \(troca perfeita/);
  assert.match(t, /Abra Trocas para propor com um toque\./);
});

test("a rota só envia aviso de trocas com a feature ligada; o teste (?dry=1) sempre roda", () => {
  const src = ler("src/app/api/cron/dai-avisos/route.ts");
  assert.match(src, /tipo === "trocas" && !dry && !temFeature\("avisoDeTrocas"\)/);
});
