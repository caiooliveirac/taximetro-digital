import test from "node:test";
import assert from "node:assert/strict";
import {
  cedeVagasDaGrade,
  mensagemDeBloqueio,
  motivoParaRecusar,
  turnosDoCompromisso,
} from "../src/features/scheduling/domain/policies/academic-commitment-policy";

const turma = { startDate: "2026-10-26", endDate: "2026-11-22" };
const base = { date: "2026-11-11", blocksDay: true, blocksNight: false, blocksEveNight: false };

test("prova de manhã com véspera bloqueia a noite anterior e o diurno", () => {
  assert.deepEqual(turnosDoCompromisso({ ...base, blocksEveNight: true }), [
    { date: "2026-11-10", period: "NIGHT" },
    { date: "2026-11-11", period: "DAY" },
  ]);
});

test("dia inteiro bloqueia diurno e noturno do dia", () => {
  assert.deepEqual(turnosDoCompromisso({ ...base, blocksNight: true }), [
    { date: "2026-11-11", period: "DAY" },
    { date: "2026-11-11", period: "NIGHT" },
  ]);
});

test("véspera atravessa o mês", () => {
  assert.equal(turnosDoCompromisso({ ...base, date: "2026-12-01", blocksEveNight: true })[0].date, "2026-11-30");
});

test("recusa data fora da turma, sem turno e data passada", () => {
  assert.equal(motivoParaRecusar({ compromisso: base, turma, hoje: "2026-11-05" }), null);
  assert.match(motivoParaRecusar({ compromisso: { ...base, date: "2026-11-23" }, turma, hoje: "2026-11-05" })!, /fora do período/);
  assert.match(motivoParaRecusar({ compromisso: { ...base, blocksDay: false }, turma, hoje: "2026-11-05" })!, /turno/);
  assert.match(motivoParaRecusar({ compromisso: base, turma, hoje: "2026-11-12" })!, /passada/);
  // Véspera já passada também recusa: o plantão de ontem não sai mais.
  assert.match(motivoParaRecusar({ compromisso: { ...base, blocksEveNight: true }, turma, hoje: "2026-11-11" })!, /passada/);
});

test("só a turma inteira cede vaga, e só sem outra turma no dia", () => {
  assert.equal(cedeVagasDaGrade({ turmaInteira: true, date: "2026-11-11", outrasTurmas: [] }), true);
  assert.equal(cedeVagasDaGrade({ turmaInteira: false, date: "2026-11-11", outrasTurmas: [] }), false);
  assert.equal(cedeVagasDaGrade({
    turmaInteira: true, date: "2026-10-27", outrasTurmas: [{ startDate: "2026-09-28", endDate: "2026-10-28" }],
  }), false);
  assert.equal(cedeVagasDaGrade({
    turmaInteira: true, date: "2026-11-11", outrasTurmas: [{ startDate: "2026-09-28", endDate: "2026-10-28" }],
  }), true);
});

test("mensagem diz o compromisso, o turno e o dia", () => {
  assert.equal(
    mensagemDeBloqueio("Você", "Prova de Clínica", { date: "2026-11-11", period: "DAY" }),
    "Você tem Prova de Clínica no diurno de 11/11 (agenda da turma).",
  );
});
