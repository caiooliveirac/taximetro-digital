import assert from "node:assert/strict";
import test from "node:test";

import { removalNote } from "../src/features/scheduling/application/use-cases/update-assignment-status";
import { isCruFixedReactivatableNote } from "../src/lib/cru-fixed";

const DIA = new Date("2026-08-08T15:00:00Z");

test("cancelamento assinado não é reativado pela materialização do CRU fixo", () => {
  for (const papel of ["COORDINATOR", "LEADER", "PRECEPTOR", "QUALQUER"]) {
    assert.equal(isCruFixedReactivatableNote(removalNote(papel, DIA)), false, papel);
  }
});

test("a nota diz quem removeu e quando", () => {
  assert.equal(removalNote("COORDINATOR", DIA), "Removido da escala pelo admin em 08/08/2026");
  assert.equal(removalNote("LEADER", DIA), "Removido da escala pelo líder em 08/08/2026");
  assert.equal(removalNote("PAPEL_NOVO", DIA), "Removido da escala manualmente em 08/08/2026");
});
