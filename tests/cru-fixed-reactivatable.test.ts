import assert from "node:assert/strict";
import test from "node:test";

import {
  CRU_FIXED_NOTE,
  CRU_FIXED_REMOVED_NOTE,
  isCruFixedReactivatableNote,
} from "../src/lib/cru-fixed";

test("isCruFixedReactivatableNote: reativa quando note é CRU_FIXED_NOTE original", () => {
  assert.equal(isCruFixedReactivatableNote(CRU_FIXED_NOTE), true);
});

test("isCruFixedReactivatableNote: reativa quando note é CRU_FIXED_REMOVED_NOTE (cancelado pelo próprio fluxo CRU)", () => {
  // Esta é a regressão do bug de 2026-05-06: REMOVE de template seta esta note,
  // e o ADD subsequente precisava enxergar este caso como reativável em vez de skip.
  assert.equal(isCruFixedReactivatableNote(CRU_FIXED_REMOVED_NOTE), true);
});

test("isCruFixedReactivatableNote: NÃO reativa cancelamento manual de líder", () => {
  assert.equal(isCruFixedReactivatableNote("Removido da escala pelo líder em 05/05/2026"), false);
});

test("isCruFixedReactivatableNote: NÃO reativa cancelamento por troca", () => {
  assert.equal(isCruFixedReactivatableNote("Trocado via solicitação"), false);
});

test("isCruFixedReactivatableNote: NÃO reativa quando note é null (cancelamento sem rastro de origem CRU)", () => {
  assert.equal(isCruFixedReactivatableNote(null), false);
});

test("isCruFixedReactivatableNote: NÃO reativa note arbitrária", () => {
  assert.equal(isCruFixedReactivatableNote("qualquer outra coisa"), false);
});
