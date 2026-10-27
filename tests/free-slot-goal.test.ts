/**
 * Vaga livre é para quem precisa: o líder escala sozinho só interno abaixo da
 * meta do tipo da vaga; acima disso vira pedido que só a coordenação aprova.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { textoMetaCumprida } from "../src/features/extra-offers/application/use-cases/free-slot-goal";

const ler = (arquivo: string) => readFileSync(path.join(process.cwd(), arquivo), "utf8");

test("líder em vaga livre com interno de meta coberta recebe META_CUMPRIDA, não alocação", () => {
  const src = ler("src/features/extra-offers/application/use-cases/claim-extra-offer.ts");
  assert.match(src, /vagaLivre && actor\.role === "LEADER" && !params\.isImpersonating/);
  assert.match(src, /code: "META_CUMPRIDA"/);
  assert.match(src, /type: "FREE_SLOT"/);
});

test("pedido de vaga livre só a coordenação aprova, e some da lista do líder", () => {
  assert.match(ler("src/features/requests/application/use-cases/review-request.ts"), /request\.type === "FREE_SLOT" && actor\.role !== "COORDINATOR"/);
  assert.match(ler("src/features/requests/application/use-cases/list-requests.ts"), /r\.type !== "FREE_SLOT"/);
});

test("a mensagem diz o tipo, a meta e o caminho", () => {
  const msg = textoMetaCumprida("Fulano", { kind: "USA", target: 6, missing: 0, cumprida: true });
  assert.match(msg, /Fulano já tem a meta de USA coberta \(6 na rotação/);
  assert.match(msg, /Peça autorização à coordenação/);
});
