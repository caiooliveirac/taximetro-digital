/**
 * Toda rota exclusiva de uma instância precisa se bloquear no servidor.
 *
 * Este teste é estrutural de propósito. O risco real não é o bloqueio de hoje
 * parar de funcionar — é alguém adicionar amanhã uma rota nova da Vitalmed e
 * esquecer o bloqueio, deixando-a aberta no SAMU para quem digitar a URL.
 * Esconder o item do menu não protege nada.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** Arquivo → feature que ele precisa exigir. */
const ROTAS_EXCLUSIVAS: Array<{ arquivo: string; feature: string }> = [
  { arquivo: "src/app/api/intern/unavailability/route.ts", feature: "internUnavailability" },
  { arquivo: "src/app/intern/indisponibilidade/page.tsx", feature: "internUnavailability" },
  { arquivo: "src/app/api/admin/lottery/route.ts", feature: "adminLottery" },
];

for (const { arquivo, feature } of ROTAS_EXCLUSIVAS) {
  test(`${arquivo} bloqueia no servidor pela feature ${feature}`, () => {
    const caminho = path.join(process.cwd(), arquivo);
    assert.ok(existsSync(caminho), `arquivo não encontrado: ${arquivo}`);

    const fonte = readFileSync(caminho, "utf8");
    const usaGate =
      fonte.includes(`bloqueioDeFeature("${feature}")`) ||
      fonte.includes(`exigirFeature("${feature}")`);

    assert.ok(
      usaGate,
      `${arquivo} não chama bloqueioDeFeature/exigirFeature com "${feature}" — ` +
        `a rota ficaria acessível na instância que não tem a funcionalidade`,
    );
  });
}

test("o bloqueio acontece antes de qualquer leitura de dados", () => {
  // Se o gate vier depois de uma consulta, a instância errada já pagou o custo
  // (e pode vazar existência do recurso por timing ou por erro de banco).
  for (const { arquivo } of ROTAS_EXCLUSIVAS) {
    const fonte = readFileSync(path.join(process.cwd(), arquivo), "utf8");
    const posGate = Math.min(
      ...["bloqueioDeFeature(", "exigirFeature("]
        .map((marca) => fonte.indexOf(marca))
        .filter((i) => i >= 0),
    );
    const posAwait = fonte.indexOf("await ");
    if (posAwait === -1) continue;
    assert.ok(
      posGate < posAwait,
      `${arquivo}: o bloqueio de feature precisa vir antes do primeiro await`,
    );
  }
});
