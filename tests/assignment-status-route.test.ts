import assert from "node:assert/strict";
import test from "node:test";

import { assignmentStatusEnum } from "../src/db/schema";
import {
  executeUpdateAssignmentStatus,
  STATUS_ACEITOS_NESTA_ROTA,
} from "../src/features/scheduling/application/use-cases/update-assignment-status";

const ator = { id: "u", role: "LEADER", facultyId: "f", isImpersonating: false, realUserId: null };

test("rota genérica de status recusa tudo que não é cancelamento, antes de tocar o banco", async () => {
  const recusados = [
    ...assignmentStatusEnum.enumValues.filter((s) => !STATUS_ACEITOS_NESTA_ROTA.includes(s)),
    "QUALQUER",
    undefined as unknown as string,
  ];
  assert.equal(recusados.length, assignmentStatusEnum.enumValues.length + 1);

  for (const status of recusados) {
    const r = await executeUpdateAssignmentStatus({ actor: ator, input: { id: "x", status } });
    assert.equal(r.status, 400, String(status));
  }
});
