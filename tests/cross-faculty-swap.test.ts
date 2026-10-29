/**
 * Troca de USA entre internos de faculdades diferentes.
 *
 * O que estes testes seguram: só USA atravessa faculdade, e cada plantão
 * cedido vira vaga liberada já ocupada (`TROCA`) da faculdade dona — senão a
 * grade dela mostra a vaga vazia e o líder ou o cron a preenchem de novo.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cessoesDaTroca, podeTrocarEntreFaculdades } from "../src/shared/domain/policies/cross-faculty-swap-policy";

const ler = (arquivo: string) => readFileSync(path.join(process.cwd(), arquivo), "utf8");

const plantao = (internId: string, facultyId: string, baseId: string, date: string) => ({
  internId, facultyId, baseId, date, period: "DAY" as const, shift: null,
});

test("só USA troca entre faculdades", () => {
  assert.equal(podeTrocarEntreFaculdades("USA"), true);
  assert.equal(podeTrocarEntreFaculdades("CENTRAL"), false);
  assert.equal(podeTrocarEntreFaculdades("CRL"), false);
  assert.equal(podeTrocarEntreFaculdades(null), false);
});

test("mesma faculdade: troca não cede vaga nenhuma", () => {
  const rows = cessoesDaTroca({
    original: plantao("ana", "unifacs", "cb02", "2026-11-03"),
    alvo: plantao("bia", "unifacs", "it30", "2026-11-05"),
    novoDoAlvo: "n1", novoDoOriginal: "n2", publishedBy: "ana", agora: new Date(),
  });
  assert.deepEqual(rows, []);
});

test("faculdades diferentes: cada vaga fica com a dona, ocupada por quem recebeu", () => {
  const agora = new Date("2026-10-29T15:00:00Z");
  const [doOriginal, doAlvo] = cessoesDaTroca({
    original: plantao("ana", "unifacs", "cb02", "2026-11-03"),
    alvo: plantao("bia", "ebmsp", "it30", "2026-11-05"),
    novoDoAlvo: "plantao-da-bia-na-cb02",
    novoDoOriginal: "plantao-da-ana-na-it30",
    publishedBy: "ana",
    agora,
  });
  // CB02 era da UNIFACS (da Ana) e agora é a Bia que está lá.
  assert.equal(doOriginal.baseId, "cb02");
  assert.equal(doOriginal.date, "2026-11-03");
  assert.equal(doOriginal.releasedFacultyId, "unifacs");
  assert.equal(doOriginal.claimedBy, "bia");
  assert.equal(doOriginal.assignmentId, "plantao-da-bia-na-cb02");
  // IT30 era da EBMSP (da Bia) e agora é a Ana que está lá.
  assert.equal(doAlvo.baseId, "it30");
  assert.equal(doAlvo.releasedFacultyId, "ebmsp");
  assert.equal(doAlvo.claimedBy, "ana");
  assert.equal(doAlvo.assignmentId, "plantao-da-ana-na-it30");
  for (const row of [doOriginal, doAlvo]) {
    assert.equal(row.autoRelease, "TROCA");
    assert.equal(row.claimedAt, agora);
  }
});

test("proposta e confirmação barram CRU/CRL entre faculdades antes de mexer na escala", () => {
  const src = ler("src/features/requests/application/use-cases/handle-swap-peer-action.ts");
  assert.match(src, /!sharesFaculty && !podeTrocarEntreFaculdades\(offeredType\)/);
  const checagem = src.indexOf("entreFaculdades && !podeTrocarEntreFaculdades(baseType)");
  const cancela = src.indexOf("await cancelAssignmentForSwap(origAssignment.id)");
  assert.ok(checagem > 0 && checagem < cancela, "checa o tipo antes de cancelar os plantões");
  assert.match(src, /await insertSwapCessions\(cessoesDaTroca\(/);
});

test("ofertas de outra faculdade aparecem só se forem USA", () => {
  assert.match(
    ler("src/features/requests/application/use-cases/list-requests.ts"),
    /facultyInternIds\.has\(r\.requesterId\) \|\| podeTrocarEntreFaculdades\(r\.baseType\)/,
  );
});

test("vaga cedida em troca fica fora do painel de vaga livre e conta como vaga livre usada no cron", () => {
  const src = ler("src/features/scheduling/application/use-cases/auto-release-slots.ts");
  assert.match(src, /autoRelease\} is distinct from 'TROCA'/);
  // O cron não conta o plantão vindo de vaga cedida como a faculdade usando a grade dela.
  assert.match(src, /o\.assignmentId && \(o\.releasedFacultyId \|\| o\.autoRelease === "SEM_DONO"\)/);
});
