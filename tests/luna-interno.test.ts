/**
 * Luna do interno e mensagens entre internos.
 *
 * A Luna só lê: o que ela mostra de vaga liberada segue a mesma trava do
 * líder (abaixo da meta no tipo) e a regra de 12h de descanso. As mensagens
 * só circulam entre internos/líderes, e quem personifica não escreve.
 *
 * A avaliação por perguntas reais (fixture + modelo falso) está em
 * tests/luna-avaliacao.test.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { turnoCurto } from "../src/lib/luna-ferramentas";
import { buscarOpcoes, type Meta, type Oferta } from "../src/lib/luna-inteligencia";

const ler = (arquivo: string) => readFileSync(path.join(process.cwd(), arquivo), "utf8");

const vaga = (id: string, tipo: "USA" | "CRU" | "CRL", date: string, period: "DAY" | "NIGHT"): Oferta => ({ fonte: "LIBERADA", id, baseCode: id, tipo, date, period, shift: null });
const meta = (faltam: Meta["faltam"]): Meta => ({ faculdade: "X", inicio: "2026-10-01", fim: "2026-11-30", alvo: { USA: 8, CRU: 4, CRL: 4 }, faltam, realizados: 0, faltas: 0 });
const pedido = { objetivo: "plantao" as const, ate: "2026-12-31" };

test("vaga liberada só aparece no tipo em que ainda falta meta", () => {
  const vagas = [vaga("CB02", "USA", "2026-10-31", "DAY"), vaga("CRU", "CRU", "2026-10-31", "NIGHT"), vaga("CRL", "CRL", "2026-11-01", "DAY")];
  const b = buscarOpcoes(vagas, { meta: meta({ USA: 2, CRU: 0, CRL: 1 }), meus: [], pedido, hoje: "2026-10-29" });
  assert.deepEqual(b.opcoes.map((s) => s.id), ["CB02", "CRL"]);
  assert.equal(b.descartes[0].motivo, "META_DO_TIPO_FECHADA");
});

test("meta cumprida em tudo: nenhuma vaga liberada é para o interno", () => {
  const b = buscarOpcoes([vaga("CB02", "USA", "2026-10-31", "DAY")], { meta: meta({ USA: 0, CRU: 0, CRL: 0 }), meus: [], pedido, hoje: "2026-10-29" });
  assert.equal(b.opcoes.length, 0);
});

test("vaga colada num plantão do interno sai como sem descanso", () => {
  const meus = [{ id: "m", date: "2026-10-30", period: "NIGHT" as const, shift: null, baseCode: "PM04", status: "SCHEDULED", tipo: "USA" as const, isExtraShift: false, justificativa: false, checkinStatus: null, totpValidatedAt: null, checkoutAt: null, checkoutNotes: null }];
  const b = buscarOpcoes([vaga("CB02", "USA", "2026-10-31", "DAY"), vaga("IT30", "USA", "2026-10-31", "NIGHT")], { meta: meta({ USA: 3, CRU: 0, CRL: 0 }), meus, pedido, hoje: "2026-10-29" });
  assert.deepEqual(b.opcoes.map((o) => o.id), ["IT30"]);
  assert.equal(b.descartes[0].motivo, "SEM_DESCANSO");
  assert.match(b.descartes[0].exemplo, /PM04/);
});

test("turno aparece como o interno fala", () => {
  assert.equal(turnoCurto("2026-10-30", "NIGHT"), "sex 30/10 noite");
  assert.equal(turnoCurto("2026-10-31", "DAY"), "sáb 31/10 dia");
  assert.equal(turnoCurto("2026-11-01", "DAY", "MORNING"), "dom 01/11 manhã");
});

test("ferramentas da Luna não escrevem no banco", () => {
  for (const arquivo of ["src/lib/luna-ferramentas.ts", "src/lib/luna-interno.ts", "src/lib/luna-dados.ts", "src/lib/luna-inteligencia.ts", "src/app/api/intern/luna/route.ts"]) {
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

test("vaga livre: interno não se escala sozinho; candidatura passa pela coordenação", () => {
  const claim = ler("src/features/extra-offers/application/use-cases/claim-extra-offer.ts");
  assert.match(claim, /if \(vagaLivre && !repescagem && actor\.role === "INTERN" && !alocandoOutro\) \{\s*return \{ status: 403/);
  const candidatura = ler("src/features/extra-offers/application/use-cases/candidatar-vaga-livre.ts");
  assert.match(candidatura, /semDescansoPara/);
  assert.match(candidatura, /candidaturaAberta\(fila\)/);
  assert.match(ler("src/app/api/intern/vagas-livres/candidatura/route.ts"), /if \(user\.isImpersonating\)/);
});
