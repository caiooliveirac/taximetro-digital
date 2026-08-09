/**
 * As rotas de montar escala do coordenador (`/api/admin/escala/*`).
 *
 * Elas existem porque o coordenador não é vinculado a faculdade nenhuma: a
 * faculdade vem da tela. Isso é exatamente o que precisa estar fechado — papel
 * conferido, faculdade obrigatória — em todas as quatro, sem exceção. E as rotas
 * do líder não podem passar a aceitar faculdade da requisição, senão o líder
 * monta escala na faculdade de outro.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROTAS_ADMIN = [
  "src/app/api/admin/escala/interns/route.ts",
  "src/app/api/admin/escala/lottery/route.ts",
  "src/app/api/admin/escala/cru-fixed/route.ts",
  "src/app/api/admin/escala/cru-generate/route.ts",
];

const ROTAS_LIDER = [
  "src/app/api/leader/interns/route.ts",
  "src/app/api/leader/lottery/route.ts",
  "src/app/api/leader/cru-fixed/route.ts",
  "src/app/api/leader/cru-generate/route.ts",
];

function fonte(arquivo: string) {
  return readFileSync(path.join(process.cwd(), arquivo), "utf8");
}

test("toda rota do admin resolve o escopo pelo helper, em todo handler", () => {
  for (const arquivo of ROTAS_ADMIN) {
    const src = fonte(arquivo);
    const handlers = src.match(/export async function (GET|POST|PATCH|DELETE|PUT)\b/g) ?? [];
    assert.ok(handlers.length > 0, `${arquivo} não exporta handler nenhum`);

    const escopos = src.match(/await escopoDoAdminNaEscala\(/g) ?? [];
    assert.equal(
      escopos.length,
      handlers.length,
      `${arquivo}: ${handlers.length} handler(s) e ${escopos.length} checagem(ns) de escopo`,
    );

    const guardas = src.match(/if \(!escopo\.ok\) return escopo\.resposta;/g) ?? [];
    assert.equal(
      guardas.length,
      handlers.length,
      `${arquivo}: resolveu o escopo mas não devolveu o erro em algum handler`,
    );
  }
});

test("o helper exige COORDINATOR e faculdade em uuid", () => {
  const src = fonte("src/lib/admin-escala.ts");
  assert.match(src, /user\.role !== "COORDINATOR"/);
  assert.match(src, /status: 403/);
  assert.match(src, /z\.string\(\)\.uuid\(\)/);
  assert.match(src, /status: 400/);
});

test("o sorteio do admin usa a faculdade do escopo, não a que vier no corpo", () => {
  // O corpo é do cliente. Se `parsed.data.facultyId` chegasse ao caso de uso sem
  // ser sobrescrito, bastaria mandar outro uuid no JSON para sortear a escala de
  // outra faculdade — a checagem do escopo teria olhado para o campo errado.
  const src = fonte("src/app/api/admin/escala/lottery/route.ts");
  assert.match(src, /input: \{ \.\.\.parsed\.data, facultyId: escopo\.actor\.facultyId \}/);
});

test("as rotas do líder continuam sem ler faculdade da requisição", () => {
  for (const arquivo of ROTAS_LIDER) {
    const src = fonte(arquivo);
    assert.doesNotMatch(
      src,
      /facultyId:\s*(body|parsed\.data|req\.nextUrl|searchParams)/,
      `${arquivo}: a faculdade do líder passou a vir da requisição`,
    );
    assert.match(src, /facultyId: user\.facultyId/, `${arquivo}: a faculdade deveria vir do ator`);
  }
});

test("a tela do admin fica atrás do prefixo /admin, que é só do coordenador", () => {
  // A página existe; o acesso é barrado antes dela pelo proxy (ROLE_PREFIX).
  const politica = fonte("src/lib/role-access-policy.ts");
  assert.match(politica, /COORDINATOR: "\/admin"/);
  const menu = fonte("src/app/admin/layout.tsx");
  assert.match(menu, /href: "\/admin\/montar-escala"/);
});
