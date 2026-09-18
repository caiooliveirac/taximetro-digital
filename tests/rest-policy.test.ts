import test from "node:test";
import assert from "node:assert/strict";
import { mensagemSemDescanso, plantaoSemDescanso, type TurnoDePlantao } from "../src/shared/domain/policies/rest-policy";

const t = (baseCode: string, date: string, period: "DAY" | "NIGHT", shift: string | null = null): TurnoDePlantao =>
  ({ baseCode, date, period, shift });

test("caso real: sábado dia entre sexta noite e sábado noite é barrado, e a frase nomeia os dois plantões", () => {
  const novo = t("CB02", "2026-10-24", "DAY");
  const conflito = plantaoSemDescanso(novo, [t("BR60", "2026-10-23", "NIGHT"), t("IT30", "2026-10-24", "NIGHT")]);
  assert.equal(conflito?.baseCode, "BR60");
  assert.equal(
    mensagemSemDescanso("Catharine", novo, conflito!),
    "Catharine ficaria com dois plantões seguidos, sem 12h de descanso: BR60 sex 23/10 noite e CB02 sáb 24/10 dia.",
  );
});

test("noite de USA colada no CRU do dia seguinte também é barrada", () => {
  const conflito = plantaoSemDescanso(t("SM01", "2026-10-28", "NIGHT"), [t("CRU", "2026-10-29", "DAY")]);
  assert.equal(conflito?.baseCode, "CRU");
});

test("12h de descanso bastam: sexta noite e sábado noite, ou dia seguido de dia", () => {
  assert.equal(plantaoSemDescanso(t("IT30", "2026-10-24", "NIGHT"), [t("BR60", "2026-10-23", "NIGHT")]), null);
  assert.equal(plantaoSemDescanso(t("PM04", "2026-10-13", "DAY"), [t("CRU", "2026-10-14", "DAY")]), null);
});

test("mesmo turno é barrado com a frase própria; data vinda do banco com hora também casa", () => {
  const novo = t("PM04", "2026-10-13", "DAY");
  const conflito = plantaoSemDescanso(novo, [t("CRU", "2026-10-13T00:00:00.000Z", "DAY")]);
  assert.ok(conflito);
  assert.equal(mensagemSemDescanso("Felipe", novo, conflito), "Felipe já tem plantão nesse mesmo turno: CRU ter 13/10 dia.");
});

test("EBMSP: manhã + tarde no mesmo dia pode; meio turno não conta como colado", () => {
  assert.equal(plantaoSemDescanso(t("CRU", "2026-10-13", "DAY", "MORNING"), [t("CRU", "2026-10-13", "DAY", "AFTERNOON")]), null);
  assert.ok(plantaoSemDescanso(t("CRU", "2026-10-13", "DAY", "MORNING"), [t("CRU", "2026-10-13", "DAY", "MORNING")]));
  assert.equal(plantaoSemDescanso(t("CRU", "2026-10-13", "DAY", "MORNING"), [t("SM01", "2026-10-12", "NIGHT")]), null);
});
