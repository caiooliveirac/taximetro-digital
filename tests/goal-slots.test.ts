/**
 * A casinha é a promessa que a tela faz: faculdade que exige 6 USA mostra 6
 * quadradinhos. Falta não ocupa casinha — quem faltou continua devendo o
 * plantão, e a vaga volta a aparecer com alerta para o líder escalar.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { slotStatesFromCounts, summarizeGoals, totalMissingSlots } from "../src/lib/goal-slots";

const today = "2026-09-07";

function usa(id: string, date: string, status: string) {
  return { id, date, status, baseType: "USA" };
}

const targets = { USA: 6, CRU: 1, CRL: 0 };

test("faculdade que exige 6 USA sempre mostra 6 casinhas", () => {
  const [usaGoal] = summarizeGoals(
    [usa("a", "2026-08-01", "CHECKED_OUT"), usa("b", "2026-09-20", "SCHEDULED")],
    targets,
    today,
  );
  assert.equal(usaGoal.slots.length, 6);
  assert.equal(usaGoal.filled, 2);
  assert.equal(usaGoal.missing, 4);
});

test("checkout é o que vale: passado sem checkout fica pendente e NÃO conta para a meta", () => {
  for (const status of ["SCHEDULED", "CONFIRMED", "CHECKED_IN"]) {
    const [usaGoal] = summarizeGoals([usa("a", "2026-08-01", status)], targets, today);
    assert.equal(usaGoal.slots[0].state, "pending", status);
    assert.equal(usaGoal.filled, 0, status);
    assert.equal(usaGoal.done, 0, status);
    assert.equal(usaGoal.missing, 6, status);
  }
});

test("falta não ocupa casinha da meta; abono ocupa", () => {
  const [comFalta] = summarizeGoals([usa("a", "2026-08-01", "ABSENT")], targets, today);
  assert.equal(comFalta.missed, 1);
  assert.equal(comFalta.filled, 0);
  assert.equal(comFalta.missing, 6);
  assert.equal(comFalta.slots.length, 7); // 6 da meta + a falta

  const [comAbono] = summarizeGoals([usa("a", "2026-08-01", "EXCUSED")], targets, today);
  assert.equal(comAbono.filled, 1);
  assert.equal(comAbono.missing, 5);
});

test("cancelado não vira casinha nenhuma", () => {
  const [usaGoal] = summarizeGoals([usa("a", "2026-08-01", "CANCELLED")], targets, today);
  assert.equal(usaGoal.slots.length, 6);
  assert.equal(usaGoal.slots.every((s) => s.state === "empty"), true);
});

test("plantão extra não ocupa casinha — mesma regra do compliance", () => {
  const [usaGoal] = summarizeGoals(
    [{ ...usa("a", "2026-08-01", "CHECKED_OUT"), isExtraShift: true }],
    targets,
    today,
  );
  assert.equal(usaGoal.slots.length, 6);
  assert.equal(usaGoal.missing, 6);
});

test("meta cumprida não gera alerta; tipo sem meta não gera casinha", () => {
  const cumprida = summarizeGoals(
    [
      usa("1", "2026-08-01", "CHECKED_OUT"),
      usa("2", "2026-08-02", "CHECKED_OUT"),
      usa("3", "2026-08-03", "CHECKED_OUT"),
      usa("4", "2026-08-04", "CHECKED_OUT"),
      usa("5", "2026-08-05", "CHECKED_OUT"),
      usa("6", "2026-09-30", "SCHEDULED"),
      { id: "c", date: "2026-08-10", status: "CHECKED_OUT", baseType: "CENTRAL" },
    ],
    targets,
    today,
  );
  assert.equal(totalMissingSlots(cumprida), 0);
  assert.equal(cumprida.find((s) => s.kind === "CRL")!.slots.length, 0);
});

test("plantão além da meta aparece como casinha extra", () => {
  const [usaGoal] = summarizeGoals(
    Array.from({ length: 8 }, (_, i) => usa(`x${i}`, `2026-08-0${i + 1}`, "CHECKED_OUT")),
    targets,
    today,
  );
  assert.equal(usaGoal.slots.length, 8);
  assert.equal(usaGoal.missing, 0);
});

test("na lista, as casinhas saem da contagem do compliance", () => {
  // 6 USA de meta: 2 realizados, 1 agendado, 3 sem ninguém escalar.
  const states = slotStatesFromCounts({ done: 2, planned: 3, missing: 3 });
  assert.deepEqual(states, ["done", "done", "scheduled", "empty", "empty", "empty"]);
});

test("contagem inconsistente não vira casinha negativa", () => {
  assert.deepEqual(slotStatesFromCounts({ done: 4, planned: 2, missing: 0 }), ["done", "done", "done", "done"]);
});

// S2OUT-72: hoje antes do início não é pendência (#83: pendente é o que já
// começou sem checkout). Antes, o plantão de hoje que ainda não começou abria
// uma casinha vazia na meta.
test("plantão de hoje que ainda não começou é agendado e ocupa a casinha", () => {
  const cedo = new Date("2026-09-07T08:00:00Z"); // 05:00 em Salvador
  const [usaGoal] = summarizeGoals([{ ...usa("a", today, "SCHEDULED"), period: "DAY" }], targets, today, cedo);
  assert.equal(usaGoal.slots[0].state, "scheduled");
  assert.equal(usaGoal.filled, 1);
  assert.equal(usaGoal.missing, 5);

  const tarde = new Date("2026-09-07T18:00:00Z"); // 15:00: o noturno ainda não começou
  const [noturno] = summarizeGoals([{ ...usa("b", today, "CONFIRMED"), period: "NIGHT" }], targets, today, tarde);
  assert.equal(noturno.slots[0].state, "scheduled");
  assert.equal(noturno.missing, 5);

  const manha = new Date("2026-09-07T13:00:00Z"); // 10:00: CRU da tarde (EBMSP) começa às 13:00
  const cru = summarizeGoals(
    [{ id: "c", date: today, status: "SCHEDULED", baseType: "CENTRAL", period: "DAY", shift: "AFTERNOON" }],
    targets,
    today,
    manha,
  ).find((s) => s.kind === "CRU")!;
  assert.equal(cru.slots[0].state, "scheduled");
  assert.equal(cru.missing, 0);
});

test("plantão de hoje que já começou sem checkout continua pendente", () => {
  const depois = new Date("2026-09-07T12:00:00Z"); // 09:00: diurno em curso
  const [usaGoal] = summarizeGoals([{ ...usa("a", today, "CHECKED_IN"), period: "DAY" }], targets, today, depois);
  assert.equal(usaGoal.slots[0].state, "pending");
  assert.equal(usaGoal.filled, 0);
  assert.equal(usaGoal.missing, 6);
});

test("o compliance manda o turno para as casinhas", () => {
  const repo = readFileSync(path.join(process.cwd(), "src/features/compliance/infra/repositories/compliance-repository.ts"), "utf8");
  const fn = repo.slice(repo.indexOf("export async function listNonCancelledAssignmentsForInterns"));
  assert.match(fn, /period: assignments\.period/);
  assert.match(fn, /shift: assignments\.shift/);
});
