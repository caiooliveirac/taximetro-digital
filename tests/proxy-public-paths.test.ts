import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// O cron do container chama /api/cron/* sem sessão; a rota valida a chave
// (AUTH_SECRET) sozinha. Se o proxy exigir login, a varredura de faltas
// silenciosamente para (aconteceu em LIVE: 401 todo dia às 12:40).
test("rotas de cron são públicas no proxy", () => {
  const src = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const match = src.match(/const PUBLIC_PATHS = \[([^\]]*)\]/);
  assert.ok(match, "PUBLIC_PATHS não encontrado");
  assert.ok(match![1].includes('"/api/cron"'), "/api/cron precisa estar em PUBLIC_PATHS");
});
