/**
 * Plantão em data passada pelo POST /api/assignments.
 *
 * Escalar retroativo é só da coordenação. O líder chamando a rota direto com
 * data passada recebe 400 antes de qualquer consulta ao banco — a mesma trava
 * que o aca1db4 pôs no claim de vaga cedida.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { executeCreateAssignment } from "../src/features/scheduling/application/use-cases/create-assignment";
import { localDateStr } from "../src/lib/utils";

const uuid = "00000000-0000-4000-8000-000000000000";
const ontem = (() => {
  const [y, m, d] = localDateStr().split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
})();

const input = {
  internId: uuid,
  facultyId: uuid,
  baseId: uuid,
  date: ontem,
  period: "DAY" as const,
  isExtraShift: false,
};

const lider = { id: uuid, role: "LEADER", facultyId: uuid, isImpersonating: false, realUserId: null };

test("líder não cria plantão em data passada", async () => {
  const r = await executeCreateAssignment({ actor: lider, input });
  assert.equal(r.status, 400);
});

test("líder não cria plantão em data passada nem pedindo o override da coordenação", async () => {
  const r = await executeCreateAssignment({ actor: lider, input: { ...input, allowRetroactiveOverride: true } });
  assert.equal(r.status, 400);
});

test("plantão extra em data passada também é recusado ao líder", async () => {
  const r = await executeCreateAssignment({ actor: lider, input: { ...input, isExtraShift: true } });
  assert.equal(r.status, 400);
});
