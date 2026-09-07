/**
 * Vaga liberada pela faculdade (release-slots.ts).
 *
 * A garantia: vaga que a faculdade liberou numa data/turno sai do sorteio — o
 * motor desconta a liberação da capacidade, pega ou não por outra faculdade.
 * E as rotas novas seguem o mesmo fechamento de escopo das outras da tela.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildWeekPositions } from "../src/features/scheduling/application/use-cases/run-leader-lottery";

const semana = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];
const regras = [
  { baseId: "b1", baseCode: "SM01", baseType: "USA", dayOfWeek: "THU", period: "DAY", capacity: 2 },
  { baseId: "b1", baseCode: "SM01", baseType: "USA", dayOfWeek: "THU", period: "NIGHT", capacity: 1 },
  { baseId: "b2", baseCode: "PM04", baseType: "USA", dayOfWeek: "FRI", period: "DAY", capacity: 1 },
];

function vagas(released?: Map<string, number>) {
  return buildWeekPositions({ rules: regras, weekExisting: [], weekDates: semana, isEbmsp: false, released })
    .map((p) => `${p.baseCode}|${p.date}|${p.period}`);
}

test("sem liberação, todas as vagas entram", () => {
  assert.deepEqual(vagas(), [
    "SM01|2026-09-10|DAY", "SM01|2026-09-10|DAY", "PM04|2026-09-11|DAY", "SM01|2026-09-10|NIGHT",
  ]);
});

test("liberar o diurno da quinta tira só o diurno da quinta", () => {
  const released = new Map([["b1|2026-09-10|DAY", 2]]);
  assert.deepEqual(vagas(released), ["PM04|2026-09-11|DAY", "SM01|2026-09-10|NIGHT"]);
});

test("liberar uma vaga de base com capacidade 2 deixa a outra no sorteio", () => {
  const released = new Map([["b1|2026-09-10|DAY", 1]]);
  assert.deepEqual(vagas(released), ["SM01|2026-09-10|DAY", "PM04|2026-09-11|DAY", "SM01|2026-09-10|NIGHT"]);
});

test("liberação somada a plantão já marcado nunca fica negativa", () => {
  const released = new Map([["b1|2026-09-10|DAY", 2]]);
  const existente = [{ baseId: "b1", baseType: "USA", date: "2026-09-10", period: "DAY", shift: null }];
  const lista = buildWeekPositions({ rules: regras, weekExisting: existente, weekDates: semana, isEbmsp: false, released });
  assert.equal(lista.filter((p) => p.baseId === "b1" && p.period === "DAY").length, 0);
});

test("o sorteio desconta as liberações da faculdade na janela", () => {
  const src = readFileSync(path.join(process.cwd(), "src/features/scheduling/application/use-cases/run-leader-lottery.ts"), "utf8");
  assert.match(src, /listReleasedOffers\(\{ facultyId, from: windowStart, to: windowEnd \}\)/);
  assert.match(src, /buildWeekPositions\(\{ rules, weekExisting, weekDates, isEbmsp, released \}\)/);
});

test("interno não pega vaga que a própria faculdade liberou", () => {
  const src = readFileSync(path.join(process.cwd(), "src/features/extra-offers/application/use-cases/claim-extra-offer.ts"), "utf8");
  assert.match(src, /offer\.releasedFacultyId === facultyId/);
});

test("liberar aceita escopo: só intervenção (padrão) ou regulação também", () => {
  const src = readFileSync(path.join(process.cwd(), "src/features/scheduling/application/use-cases/release-slots.ts"), "utf8");
  assert.match(src, /scope: z\.enum\(\["USA", "ALL"\]\)\.default\("USA"\)/);
  assert.match(src, /input\.scope === "ALL" \|\| shouldIncludeRuleInLottery\(rule, isEbmsp\)/);
});

test("CRU fixo não nasce em dia/turno que a faculdade liberou", () => {
  const src = readFileSync(path.join(process.cwd(), "src/lib/cru-fixed.ts"), "utf8");
  assert.match(src, /eq\(extraShiftOffers\.releasedFacultyId, params\.facultyId\)/);
  assert.match(src, /releasedCru\.has\(`\$\{date\}\|\$\{template\.period\}`\)/);
  assert.match(src, /status: "RELEASED"/);
});

test("vaga livre: líder aloca interno de outra faculdade pela oferta, como plantão normal", () => {
  const src = readFileSync(path.join(process.cwd(), "src/features/extra-offers/application/use-cases/claim-extra-offer.ts"), "utf8");
  assert.match(src, /\["LEADER", "COORDINATOR"\]\.includes\(actor\.role\)/);
  assert.match(src, /isExtraShift: !vagaLivre/);
  assert.match(src, /action: "FREE_SLOT_USED"/);
});

test("vaga liberada não aparece no board de extras", () => {
  const src = readFileSync(path.join(process.cwd(), "src/features/extra-offers/infra/repositories/extra-offer-repository.ts"), "utf8");
  const filtros = src.match(/isNull\(extraShiftOffers\.releasedFacultyId\)/g) ?? [];
  assert.ok(filtros.length >= 4, `esperava filtro nas listas do board e analytics, achei ${filtros.length}`);
});

test("auditoria de vaga liberada/usada sai em português", () => {
  const src = readFileSync(path.join(process.cwd(), "src/features/audit/application/use-cases/list-audit-log.ts"), "utf8");
  assert.match(src, /liberou \$\{n\} vaga/);
  assert.match(src, /foi escalado na vaga livre que a/);
  const page = readFileSync(path.join(process.cwd(), "src/app/admin/audit/page.tsx"), "utf8");
  assert.match(page, /FREE_SLOT_USED: "Vaga livre usada"/);
});

test("liberar o dia inteiro tira da escala quem ainda não começou; liberar uma vaga pela grade não tira ninguém", () => {
  const src = readFileSync(path.join(process.cwd(), "src/features/scheduling/application/use-cases/release-slots.ts"), "utf8");
  assert.match(src, /preview: z\.boolean\(\)\.default\(false\)/);
  assert.match(src, /const removiveis = input\.baseId\s*\?\s*\[\]/);
  assert.match(src, /status: "CANCELLED"/);
  const repo = readFileSync(path.join(process.cwd(), "src/features/scheduling/infra/repositories/lottery-repository.ts"), "utf8");
  assert.match(repo, /inArray\(assignments\.status, \["SCHEDULED", "CONFIRMED"\]\)/);
  assert.match(repo, /eq\(assignments\.isExtraShift, false\)/);
});

test("Escala do coordenador mostra a vaga cedida e aloca pela oferta", () => {
  const src = readFileSync(path.join(process.cwd(), "src/components/admin-filled-schedule.tsx"), "utf8");
  assert.match(src, /kind: "freed"/);
  assert.match(src, /api\/admin\/released-slots\?from=/);
  assert.match(src, /allocation\.freeOffer\s*\?\s*await fetch\(`\/taximetro\/api\/extra-offers\/\$\{allocation\.freeOffer\.id\}`/);
  const rota = readFileSync(path.join(process.cwd(), "src/app/api/admin/released-slots/route.ts"), "utf8");
  assert.match(rota, /user\.role !== "COORDINATOR"/);
  const politica = readFileSync(path.join(process.cwd(), "src/features/scheduling/domain/policies/assignment-policy.ts"), "utf8");
  assert.match(politica, /slot\.kind === "freed"/);
});

test("a vaga própria diz a sigla da faculdade; a de outra diz quem cedeu", () => {
  const src = readFileSync(path.join(process.cwd(), "src/components/scheduling/montar-escala.tsx"), "utf8");
  assert.match(src, /`Vaga \$\{myAbbr\}`/);
  assert.match(src, /Cedida pela \{f\.releasedFacultyAbbr\}/);
  assert.doesNotMatch(src, />Vaga livre · /);
});
