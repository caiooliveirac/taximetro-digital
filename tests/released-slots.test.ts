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
import { bloqueiaDataPassada } from "../src/features/extra-offers/application/use-cases/claim-extra-offer";

const semana = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];
const regras = [
  { baseId: "b1", baseCode: "SM01", baseType: "USA", dayOfWeek: "THU", period: "DAY", capacity: 2 },
  { baseId: "b1", baseCode: "SM01", baseType: "USA", dayOfWeek: "THU", period: "NIGHT", capacity: 1 },
  { baseId: "b2", baseCode: "PM04", baseType: "USA", dayOfWeek: "FRI", period: "DAY", capacity: 1 },
];

function vagas(released?: Map<string, number>) {
  return buildWeekPositions({ rules: regras, weekExisting: [], weekDates: semana, sorteiaCru: false, meioTurno: false, released })
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
  const lista = buildWeekPositions({ rules: regras, weekExisting: existente, weekDates: semana, sorteiaCru: false, meioTurno: false, released });
  assert.equal(lista.filter((p) => p.baseId === "b1" && p.period === "DAY").length, 0);
});

test("o sorteio desconta as liberações da faculdade na janela", () => {
  const src = readFileSync(path.join(process.cwd(), "src/features/scheduling/application/use-cases/run-leader-lottery.ts"), "utf8");
  assert.match(src, /listReleasedOffers\(\{ facultyId, from: windowStart, to: windowEnd \}\)/);
  assert.match(src, /buildWeekPositions\(\{ rules, weekExisting, weekDates, sorteiaCru, meioTurno, released \}\)/);
});

test("interno não pega vaga que a própria faculdade liberou", () => {
  const src = readFileSync(path.join(process.cwd(), "src/features/extra-offers/application/use-cases/claim-extra-offer.ts"), "utf8");
  assert.match(src, /offer\.releasedFacultyId === facultyId/);
});

test("liberar aceita escopo: só intervenção (padrão) ou regulação também", () => {
  const src = readFileSync(path.join(process.cwd(), "src/features/scheduling/application/use-cases/release-slots.ts"), "utf8");
  assert.match(src, /scope: z\.enum\(\["USA", "ALL"\]\)\.default\("USA"\)/);
  assert.match(src, /input\.scope === "ALL" \|\| shouldIncludeRuleInLottery\(rule, sorteiaCru\)/);
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
  assert.match(src, /const comoExtra = !vagaLivre \|\| Boolean\(metaNaRepescagem\?\.cumprida\)/);
  assert.match(src, /isExtraShift: comoExtra/);
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
  assert.match(src, /`Cedida pela \$\{f\.releasedFacultyAbbr\}`/);
  // Vaga sem dono (liberada pelo sistema) não tem faculdade para nomear.
  assert.match(src, /"Vaga sem dono"/);
  assert.doesNotMatch(src, />Vaga livre · /);
});

// S2OUT-68: a lista de vagas livres não tinha corte de data e o claim não tinha
// trava — o líder escalava interno em data passada pela vaga cedida, por fora
// do override retroativo, que é só da coordenação.
test("vaga cedida de data passada: o líder não usa; a coordenação só com o override", () => {
  const hoje = "2026-10-20";
  assert.equal(bloqueiaDataPassada({ offerDate: "2026-10-19", actorRole: "LEADER", today: hoje }), true);
  assert.equal(bloqueiaDataPassada({ offerDate: "2026-10-19", actorRole: "LEADER", allowRetroactiveOverride: true, today: hoje }), true);
  assert.equal(bloqueiaDataPassada({ offerDate: "2026-10-19", actorRole: "INTERN", today: hoje }), true);
  assert.equal(bloqueiaDataPassada({ offerDate: "2026-10-19", actorRole: "COORDINATOR", today: hoje }), true);
  assert.equal(bloqueiaDataPassada({ offerDate: "2026-10-19", actorRole: "COORDINATOR", allowRetroactiveOverride: true, today: hoje }), false);
  // Hoje e futuro seguem livres para todo mundo.
  assert.equal(bloqueiaDataPassada({ offerDate: hoje, actorRole: "LEADER", today: hoje }), false);
  assert.equal(bloqueiaDataPassada({ offerDate: "2026-10-27", actorRole: "INTERN", today: hoje }), false);
});

test("a trava de data passada está no claim, e a lista de vagas livres corta o passado", () => {
  const claim = readFileSync(path.join(process.cwd(), "src/features/extra-offers/application/use-cases/claim-extra-offer.ts"), "utf8");
  assert.match(claim, /if \(bloqueiaDataPassada\(\{ offerDate: offer\.date, actorRole: actor\.role, allowRetroactiveOverride: params\.allowRetroactiveOverride, today \}\)\)/);
  const repo = readFileSync(path.join(process.cwd(), "src/features/extra-offers/infra/repositories/extra-offer-repository.ts"), "utf8");
  const listFree = repo.slice(repo.indexOf("export async function listFreeOffers"), repo.indexOf("export async function cancelReleasedOffers"));
  assert.match(listFree, /gte\(extraShiftOffers\.date, localDateStr\(\)\)/);
  // A grade do coordenador manda o override quando a data é passada.
  const grade = readFileSync(path.join(process.cwd(), "src/components/admin-filled-schedule.tsx"), "utf8");
  assert.match(grade, /JSON\.stringify\(\{ internId: allocInternId, facultyId, allowRetroactiveOverride: isRetroactiveAdminAllocation \}\)/);
  const rota = readFileSync(path.join(process.cwd(), "src/app/api/extra-offers/[id]/route.ts"), "utf8");
  assert.match(rota, /allowRetroactiveOverride: body\.allowRetroactiveOverride === true/);
});
