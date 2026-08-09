import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  baseDaEscala,
  cabecalhosDaEscala,
  corpoComFaculdade,
  escopoDeEscala,
  urlComFaculdade,
} from "../src/features/scheduling/domain/policies/escala-scope";

const FACULDADE = "22222222-2222-4222-8222-222222222222";

test("sem faculdade é o líder; com faculdade é o coordenador", () => {
  assert.deepEqual(escopoDeEscala(), { tipo: "leader" });
  assert.deepEqual(escopoDeEscala(null), { tipo: "leader" });
  assert.deepEqual(escopoDeEscala(""), { tipo: "leader" });
  assert.deepEqual(escopoDeEscala(FACULDADE), { tipo: "admin", facultyId: FACULDADE });
});

test("cada escopo fala com a sua base de rotas", () => {
  assert.equal(baseDaEscala({ tipo: "leader" }), "/taximetro/api/leader");
  assert.equal(baseDaEscala({ tipo: "admin", facultyId: FACULDADE }), "/taximetro/api/admin/escala");
});

test("no líder a faculdade nunca entra na requisição", () => {
  const escopo = escopoDeEscala();
  assert.equal(urlComFaculdade("/taximetro/api/leader/interns", escopo), "/taximetro/api/leader/interns");
  assert.deepEqual(corpoComFaculdade({ weekStart: "2026-08-10" }, escopo), { weekStart: "2026-08-10" });
  assert.deepEqual(cabecalhosDaEscala(escopo), {});
});

test("no admin a faculdade entra na query respeitando query já existente", () => {
  const escopo = escopoDeEscala(FACULDADE);
  assert.equal(
    urlComFaculdade("/taximetro/api/admin/escala/interns", escopo),
    `/taximetro/api/admin/escala/interns?facultyId=${FACULDADE}`,
  );
  assert.equal(
    urlComFaculdade("/taximetro/api/assignments?from=2026-08-10&to=2026-08-16", escopo),
    `/taximetro/api/assignments?from=2026-08-10&to=2026-08-16&facultyId=${FACULDADE}`,
  );
});

test("no admin a faculdade entra no corpo sem apagar o resto", () => {
  const escopo = escopoDeEscala(FACULDADE);
  assert.deepEqual(
    corpoComFaculdade({ weekStart: "2026-08-10", internIds: ["a"] }, escopo),
    { weekStart: "2026-08-10", internIds: ["a"], facultyId: FACULDADE },
  );
});

test("no admin vai x-no-impersonate junto dos cabeçalhos pedidos", () => {
  const escopo = escopoDeEscala(FACULDADE);
  assert.deepEqual(cabecalhosDaEscala(escopo, { "Content-Type": "application/json" }), {
    "Content-Type": "application/json",
    "x-no-impersonate": "1",
  });
});

// Sem esse cabeçalho, o cookie de impersonate (que sobrevive à navegação) faria
// o servidor resolver a requisição como o líder visitado por último — a
// faculdade escolhida na tela seria trocada pela dele, calado.
test("a tela do admin manda x-no-impersonate em toda requisição", () => {
  const tela = readFileSync(
    path.join(process.cwd(), "src/components/scheduling/montar-escala.tsx"),
    "utf8",
  );
  const chamadasDeFetch = tela.match(/\bfetch\(/g) ?? [];
  assert.equal(
    chamadasDeFetch.length,
    2,
    "todo fetch da tela deve passar por fetchJsonNoStore/enviarJson, que aplicam o escopo",
  );
  assert.match(tela, /cabecalhosDaEscala\(escopo\)/);
  assert.match(tela, /cabecalhosDaEscala\(escopo, \{ "Content-Type": "application\/json" \}\)/);
});
