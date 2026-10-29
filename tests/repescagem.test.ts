/**
 * Repescagem: vaga livre aberta 8h antes do turno vira extra. Confere a
 * janela (sem madrugada), quem a Dai avisa, o texto e como a Dai do chat
 * apresenta a vaga.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { aberturaDaRepescagem, naRepescagem } from "../src/features/extra-offers/application/repescagem";
import { vagasParaCadaInterno } from "../src/features/dai-avisos/avisos";
import { textoRepescagem } from "../src/features/dai-avisos/textos";
import { buscarOpcoes, type Meta, type Oferta } from "../src/lib/luna-inteligencia";

const ler = (arquivo: string) => readFileSync(path.join(process.cwd(), arquivo), "utf8");
/** Hora local de Salvador (UTC−3). */
const as = (data: string, hora: number) => new Date(Date.parse(`${data}T00:00:00Z`) + (hora + 3) * 3_600_000);

test("abertura: noturno às 11h do dia; diurno e tarde da EBMSP às 20h da véspera", () => {
  assert.deepEqual(aberturaDaRepescagem("2026-10-30", "NIGHT"), { date: "2026-10-30", hour: 11 });
  assert.deepEqual(aberturaDaRepescagem("2026-10-30", "DAY"), { date: "2026-10-29", hour: 20 });
  assert.deepEqual(aberturaDaRepescagem("2026-10-30", "DAY", "AFTERNOON"), { date: "2026-10-29", hour: 20 });
  assert.deepEqual(aberturaDaRepescagem("2026-11-01", "DAY", "MORNING"), { date: "2026-10-31", hour: 20 });
});

test("janela abre na hora e fecha quando o turno começa", () => {
  assert.equal(naRepescagem("2026-10-30", "NIGHT", null, as("2026-10-30", 10)), false);
  assert.equal(naRepescagem("2026-10-30", "NIGHT", null, as("2026-10-30", 11)), true);
  assert.equal(naRepescagem("2026-10-30", "NIGHT", null, as("2026-10-30", 17)), true);
  assert.equal(naRepescagem("2026-10-30", "NIGHT", null, as("2026-10-30", 19)), false);
  assert.equal(naRepescagem("2026-10-31", "DAY", null, as("2026-10-30", 19)), false);
  assert.equal(naRepescagem("2026-10-31", "DAY", null, as("2026-10-30", 20)), true);
  assert.equal(naRepescagem("2026-10-31", "DAY", null, as("2026-10-30", 23)), true);
  // Vaga de daqui a dias nunca está na repescagem.
  assert.equal(naRepescagem("2026-11-05", "NIGHT", null, as("2026-10-30", 15)), false);
});

const vaga = (id: string, date: string, period: "DAY" | "NIGHT") =>
  ({ id, baseCode: id, tipo: "USA" as const, date, period, shift: null, releasedFacultyId: null, liberadaPor: null });
const interno = (userId: string, usa: number, quer?: string[]) =>
  ({ userId, facultyId: "fac-a", inicio: "2026-10-01", fim: "2026-11-15", faltam: { USA: usa, CRU: 0, CRL: 0 }, quer: quer ? new Set(quer) : undefined });

test("aviso: quem precisa do tipo primeiro; meta fechada só recebe se marcou Quero no turno", () => {
  const vagas = [vaga("CB02", "2026-10-30", "NIGHT")];
  const r = vagasParaCadaInterno(
    vagas,
    [interno("fechou", 0), interno("quer", 0, ["2026-10-30|NIGHT"]), interno("quer-outro", 0, ["2026-10-31|DAY"]), interno("precisa", 2)],
    new Map(),
    new Map(),
    "2026-10-30",
  );
  assert.deepEqual([...r.keys()], ["precisa", "quer"]);
});

test("texto: pega direto na aba Extras, sem o líder, e conta na meta se falta", () => {
  const t = textoRepescagem([{ baseCode: "CB02", quando: "sex 30/10 noite", tipo: "USA", liberadaPor: null }]);
  assert.match(t, /- CB02 sex 30\/10 noite \(USA, sem dono\)/);
  assert.match(t, /pega direto na aba Extras, sem passar pelo líder/);
  assert.match(t, /conta na meta; se já fechou, entra como extra — um por interno/);
});

const meta = (usa: number): Meta => ({ faculdade: "X", inicio: "2026-10-01", fim: "2026-11-30", alvo: { USA: 8, CRU: 4, CRL: 4 }, faltam: { USA: usa, CRU: 0, CRL: 0 }, realizados: 0, faltas: 0 });
const liberada = (repescagem: boolean): Oferta => ({ fonte: "LIBERADA", id: "CB02", baseCode: "CB02", tipo: "USA", date: "2026-10-30", period: "NIGHT", shift: null, repescagem });
const pedido = { objetivo: "plantao" as const, ate: "2026-12-31" };

test("Dai no chat: na repescagem a vaga é de pegar direto, até de meta fechada", () => {
  const fechada = buscarOpcoes([liberada(true)], { meta: meta(0), meus: [], pedido, hoje: "2026-10-30" });
  assert.equal(fechada.opcoes[0]?.status, "ELIGIBLE");
  assert.match(fechada.opcoes[0].porque, /pega direto na aba Extras.*não conta para a meta/);
  const precisa = buscarOpcoes([liberada(true)], { meta: meta(2), meus: [], pedido, hoje: "2026-10-30" });
  assert.equal(precisa.opcoes[0].contaParaMeta, true);
  // Já teve extra: de meta fechada não leva; precisando do tipo, leva.
  const jaTeve = { ...meta(0), jaTemExtra: true };
  assert.equal(buscarOpcoes([liberada(true)], { meta: jaTeve, meus: [], pedido, hoje: "2026-10-30" }).opcoes.length, 0);
  assert.equal(buscarOpcoes([liberada(true)], { meta: { ...meta(1), jaTemExtra: true }, meus: [], pedido, hoje: "2026-10-30" }).opcoes[0]?.status, "ELIGIBLE");
  // Fora da repescagem segue a regra antiga: meta fechada não vê vaga liberada.
  assert.equal(buscarOpcoes([liberada(false)], { meta: meta(0), meus: [], pedido, hoje: "2026-10-30" }).opcoes.length, 0);
});

test("servidor: interno só se escala em vaga livre na repescagem, e a viatura cheia trava", () => {
  const claim = ler("src/features/extra-offers/application/use-cases/claim-extra-offer.ts");
  assert.match(claim, /vagaLivre && !repescagem && actor\.role === "INTERN"/);
  assert.match(claim, /code: "BASE_CHEIA"/);
  assert.match(claim, /isExtraShift: comoExtra/);
  // Quem já teve extra não leva outro como extra só por ter visto primeiro.
  const trava = claim.indexOf('code: "JA_TEVE_EXTRA"');
  assert.ok(trava > 0 && trava < claim.indexOf("isExtraShift: comoExtra"), "trava antes de gravar");
  assert.match(claim, /repescagem && comoExtra && actor\.role !== "COORDINATOR"[^\n]*comExtraNoHistorico\(\[internId\]\)/);
  assert.match(ler("scripts/container-entrypoint.sh"), /trigger-dai-avisos\.mjs repescagem/);
});
