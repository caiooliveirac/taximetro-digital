/**
 * O velocímetro passou a responder a pergunta que o coordenador faz na aba
 * "Ver interno": com o que já está agendado, a conta fecha? 7/9 com 2 plantões
 * marcados fecha — é verde. Sem os 2 marcados, é alerta. E quando nem cabe mais
 * na rotação, é crítico.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { computeVelocimeter } from "../src/components/admin/velocimeter-card";
import { addDaysToDateStr, operationalDateStr } from "../src/lib/utils";

const today = operationalDateStr();
const base = {
  target: 9,
  completed: 7,
  rotationStartDate: addDaysToDateStr(today, -49), // 7 semanas atrás
  rotationEndDate: addDaysToDateStr(today, 21), // 3 semanas restantes
};

test("agendados que fecham a meta deixam o velocímetro verde", () => {
  const c = computeVelocimeter({ ...base, scheduled: 2 });
  assert.equal(c.faltaAgendar, 0);
  assert.equal(c.status, "ok");
  assert.equal(c.projectedPct, 100);
});

test("sem agendados, o que falta agendar aparece — mas ritmo bom segue verde", () => {
  const c = computeVelocimeter({ ...base, scheduled: 0 });
  assert.equal(c.faltaAgendar, 2);
  assert.equal(c.status, "ok"); // 2 em 3 semanas cabe no ritmo já praticado
});

test("agenda que não fecha, com ritmo nominal apertado, vira crítico", () => {
  // 3 de 9 com 3 semanas restantes: o ritmo nominal da rotação (9 em 10
  // semanas) não cobre os 6 que faltam — a conta não fecha.
  const c = computeVelocimeter({ ...base, completed: 3, scheduled: 1 });
  assert.equal(c.faltaAgendar, 5);
  assert.equal(c.status, "critico");
});

test("crítico quando nem a capacidade restante fecha a conta", () => {
  const c = computeVelocimeter({
    ...base,
    completed: 2,
    scheduled: 1,
    rotationEndDate: addDaysToDateStr(today, 7), // 1 semana, meta 2/sem
  });
  assert.equal(c.faltaAgendar, 6);
  assert.equal(c.status, "critico");
});

test("sem agendados informados, o comportamento antigo continua", () => {
  const c = computeVelocimeter(base);
  assert.equal(c.projectedPct, c.pct);
  assert.equal(c.faltaAgendar, c.restante);
});
