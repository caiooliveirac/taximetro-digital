/**
 * Luna do interno e mensagens entre internos.
 *
 * A Luna só lê: o que ela mostra de vaga liberada segue a mesma trava do
 * líder (abaixo da meta no tipo) e a regra de 12h de descanso. As mensagens
 * só circulam entre internos/líderes, e quem personifica não escreve.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { turnoCurto, vagasParaInterno } from "../src/lib/luna-ferramentas";

const ler = (arquivo: string) => readFileSync(path.join(process.cwd(), arquivo), "utf8");

const vaga = (baseCode: string, baseType: string, date: string, period: "DAY" | "NIGHT") => ({ baseCode, baseType, date, period });

test("vaga liberada só aparece no tipo em que ainda falta meta", () => {
  const vagas = [vaga("CB02", "USA", "2026-10-31", "DAY"), vaga("CRU", "CENTRAL", "2026-10-31", "NIGHT"), vaga("CRL", "CRL", "2026-11-01", "DAY")];
  const servem = vagasParaInterno(vagas, { USA: 2, CRU: 0, CRL: 1 }, []);
  assert.deepEqual(servem.map((s) => s.vaga.baseCode), ["CB02", "CRL"]);
});

test("meta cumprida em tudo: nenhuma vaga liberada é para o interno", () => {
  const servem = vagasParaInterno([vaga("CB02", "USA", "2026-10-31", "DAY")], { USA: 0, CRU: 0, CRL: 0 }, []);
  assert.equal(servem.length, 0);
});

test("vaga colada num plantão do interno vem marcada como sem descanso", () => {
  const meus = [{ date: "2026-10-30", period: "NIGHT" as const, baseCode: "PM04" }];
  const [sabadoDia, sabadoNoite] = vagasParaInterno(
    [vaga("CB02", "USA", "2026-10-31", "DAY"), vaga("IT30", "USA", "2026-10-31", "NIGHT")],
    { USA: 3 },
    meus,
  );
  assert.equal(sabadoDia.choque?.baseCode, "PM04");
  assert.equal(sabadoNoite.choque, null);
});

test("turno aparece como o interno fala", () => {
  assert.equal(turnoCurto("2026-10-30", "NIGHT"), "sex 30/10 noite");
  assert.equal(turnoCurto("2026-10-31", "DAY"), "sáb 31/10 dia");
  assert.equal(turnoCurto("2026-11-01", "DAY", "MORNING"), "dom 01/11 manhã");
});

test("ferramentas da Luna não escrevem no banco", () => {
  for (const arquivo of ["src/lib/luna-ferramentas.ts", "src/lib/luna-interno.ts", "src/app/api/intern/luna/route.ts"]) {
    assert.doesNotMatch(ler(arquivo), /\b(db|tx)\s*\.\s*(insert|update|delete)\(/, arquivo);
  }
});

test("mensagens: só interno ou líder, e quem personifica não escreve", () => {
  const src = ler("src/app/api/intern/mensagens/route.ts");
  assert.match(src, /const PAPEIS = \["INTERN", "LEADER"\] as const;/);
  assert.match(src, /if \(user\.isImpersonating\) \{\s*return NextResponse\.json\(\{ success: false/);
  // Leitura personificada não marca como lida a mensagem do interno.
  assert.match(src, /if \(!user\.isImpersonating\) \{\s*await db\s*\.update\(internMessages\)/);
});
