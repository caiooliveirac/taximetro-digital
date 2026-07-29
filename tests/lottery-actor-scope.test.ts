/**
 * Escopo de quem dispara o sorteio.
 *
 * O sorteio do admin passou a aceitar `facultyId` no corpo, porque o
 * COORDINATOR não é vinculado a nenhuma faculdade. Isso abriria um buraco se o
 * líder também pudesse mandar esse campo — ele sortearia a escala de outra
 * faculdade. Estes testes fixam o comportamento nas duas direções.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { runLeaderLotterySchema } from "../src/features/scheduling/application/use-cases/run-leader-lottery";
import { readFileSync } from "node:fs";
import path from "node:path";

const FONTE = readFileSync(
  path.join(process.cwd(), "src/features/scheduling/application/use-cases/run-leader-lottery.ts"),
  "utf8",
);

test("o schema aceita facultyId opcional", () => {
  const semFaculdade = runLeaderLotterySchema.safeParse({
    weekStart: "2026-07-27",
    internIds: ["11111111-1111-4111-8111-111111111111"],
    maxShifts: 1,
  });
  assert.equal(semFaculdade.success, true);

  const comFaculdade = runLeaderLotterySchema.safeParse({
    weekStart: "2026-07-27",
    internIds: ["11111111-1111-4111-8111-111111111111"],
    maxShifts: 1,
    facultyId: "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(comFaculdade.success, true);
});

test("a faculdade do líder vem do ator, nunca do corpo da requisição", () => {
  // Verificação estrutural: `input.facultyId` só pode ser lido no ramo do
  // coordenador. Se alguém trocar por um fallback tipo
  // `input.facultyId ?? actor.facultyId`, o líder passa a escolher a faculdade.
  assert.match(
    FONTE,
    /const facultyId = ehCoordenador \? input\.facultyId : actor\.facultyId;/,
    "a escolha da faculdade deixou de ser exclusiva do coordenador",
  );
  const usosDeInputFaculty = FONTE.match(/input\.facultyId/g) ?? [];
  assert.equal(
    usosDeInputFaculty.length,
    1,
    "input.facultyId deveria ser lido uma única vez, no ramo do coordenador",
  );
});

test("o sorteio consulta indisponibilidade antes de alocar", () => {
  // Sem esta chamada o mapa chegaria vazio ao alocador e a indisponibilidade
  // declarada pelo interno seria silenciosamente ignorada — o pior tipo de
  // falha, porque a tela continua mostrando que ele declarou.
  assert.match(FONTE, /mapaDeBloqueioPorInterno/);
  assert.match(FONTE, /temFeature\("internUnavailability"\)/);
  assert.match(FONTE, /unavailable,/, "o mapa precisa ser passado ao allocatePositions");
});
