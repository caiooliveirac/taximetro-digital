import assert from "node:assert/strict";
import test from "node:test";

import { computeCruFixedWindow, contarSemanas } from "../src/features/scheduling/domain/policies/cru-fixed-window";

const TURMA = { startDate: "2026-08-10", endDate: "2026-09-20" };

test("com turma: a janela é a da turma, não N semanas a contar de hoje", () => {
  // Era este o erro de 08/08/2026: "6 semanas" a partir do sábado consumia a
  // semana que já estava correndo e terminava uma semana antes do fim da turma.
  const janela = computeCruFixedWindow({ today: "2026-08-08", cohort: TURMA, weeks: 6 });

  assert.equal(janela.validFrom, "2026-08-10");
  assert.equal(janela.validUntil, "2026-09-20");
  assert.equal(janela.source, "cohort");
});

test("com turma que ainda não começou: não materializa antes da hora", () => {
  const janela = computeCruFixedWindow({ today: "2026-08-08", cohort: TURMA });
  assert.equal(janela.materializeFrom, "2026-08-10");
});

test("com turma já em curso: materializa a partir de hoje, não retroage", () => {
  const janela = computeCruFixedWindow({ today: "2026-08-20", cohort: TURMA });
  assert.equal(janela.validFrom, "2026-08-10", "vigência continua a da turma");
  assert.equal(janela.materializeFrom, "2026-08-20", "mas não cria plantão no passado");
});

test("sem turma: cai na duração em semanas, a partir da semana corrente", () => {
  const janela = computeCruFixedWindow({ today: "2026-04-23", cohort: null, weeks: 3 });

  assert.equal(janela.validFrom, "2026-04-20"); // segunda da semana corrente
  assert.equal(janela.validUntil, "2026-05-10"); // domingo da 3a semana
  assert.equal(janela.materializeFrom, "2026-04-23");
  assert.equal(janela.source, "weeks");
});

test("sem turma e sem semanas: uma semana, sem extrapolar", () => {
  const janela = computeCruFixedWindow({ today: "2026-04-20", cohort: null });
  assert.equal(janela.validUntil, "2026-04-26");
});

test("contarSemanas: janela da turma da PerdigãoAgo2026 são 6 semanas", () => {
  assert.equal(contarSemanas("2026-08-10", "2026-09-20"), 6);
  assert.equal(contarSemanas("2026-08-10", "2026-08-16"), 1);
  assert.equal(contarSemanas("2026-08-10", "2026-08-17"), 2); // sobrou um dia: conta a semana
});
