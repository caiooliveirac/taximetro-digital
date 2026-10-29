/**
 * Casos do Dai: texto pronto, sem modelo. O que não pode quebrar:
 * o cartão fechado não entrega o diagnóstico, a resposta só sai depois da
 * tentativa, e pergunta de plantão não vira pedido de caso.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CASOS, FICHAS, TENTATIVA_MIN, abrir, fechar, fichaDoTema, proximoCaso, resumoDosTemas } from "../src/lib/dai-casos";
import { TEMAS, pedidoDeCaso } from "../src/lib/dai-temas";

const ler = (arquivo: string) => readFileSync(path.join(process.cwd(), arquivo), "utf8");

test("60 casos, ids únicos, todo tema conhecido e nenhum campo vazio", () => {
  assert.equal(CASOS.length, 60);
  assert.equal(new Set(CASOS.map((c) => c.id)).size, 60);
  const temas = new Set<string>(TEMAS.map((t) => t.tema));
  for (const c of CASOS) {
    assert.ok(temas.has(c.tema), `${c.id}: tema ${c.tema}`);
    for (const campo of ["nome", "estimulo", "armadilha", "resposta", "fechamento", "referencia"] as const) assert.ok(c[campo].trim(), `${c.id}.${campo}`);
  }
});

test("cartão fechado não leva nome, armadilha, resposta nem referência", () => {
  for (const c of CASOS) {
    const f = fechar(c);
    assert.deepEqual(Object.keys(f).sort(), ["estimulo", "id", "nivel", "rotulo", "tema"]);
    const json = JSON.stringify(f);
    assert.ok(!json.includes(c.nome), `${c.id} entrega o nome no cartão fechado`);
    assert.ok(!json.includes(c.armadilha) && !json.includes(c.resposta), c.id);
  }
  const a = abrir(CASOS[0]);
  assert.equal(a.nome, CASOS[0].nome);
});

test("estímulo não nomeia o diagnóstico na pergunta (MINOCA corrigida)", () => {
  const minoca = CASOS.find((c) => c.id === "iam-minoca-investigacao")!;
  assert.doesNotMatch(minoca.estimulo, /investiga MINOCA/);
  for (const c of CASOS) assert.ok(!c.estimulo.includes(c.nome), c.id);
});

test("próximo caso: nível mais baixo ainda não aberto; esgotou, o aberto há mais tempo", () => {
  const avc = CASOS.filter((c) => c.tema === "AVC");
  assert.equal(proximoCaso("AVC", [])!.nivel, 3);
  const ordem = avc.map((c) => c.id);
  assert.equal(proximoCaso("AVC", ordem.slice(0, 2))!.id, ordem[2]);
  // Abriu todos; o primeiro foi reaberto depois, então o mais antigo agora é o segundo.
  assert.equal(proximoCaso("AVC", [...ordem, ordem[0]])!.id, ordem[1]);
  assert.notEqual(proximoCaso("AVC", [], ordem[0])!.id, ordem[0]);
  assert.equal(proximoCaso("XYZ", []), null);
});

test("resumo dos temas conta casos e abertos", () => {
  const r = resumoDosTemas([CASOS.find((c) => c.tema === "SEPSE")!.id]);
  assert.equal(r.length, 13);
  assert.deepEqual(r.find((t) => t.tema === "SEPSE"), { tema: "SEPSE", rotulo: "Sepse", total: 6, vistos: 1, ficha: false });
  assert.deepEqual(r.find((t) => t.tema === "PCR"), { tema: "PCR", rotulo: "PCR", total: 0, vistos: 0, ficha: true });
});

test("pedido de caso: tema, sem tema, e pergunta de plantão passa direto", () => {
  assert.equal(pedidoDeCaso("Quero discutir um caso"), null);
  assert.equal(pedidoDeCaso("caso de sepse"), "SEPSE");
  assert.equal(pedidoDeCaso("AVC"), "AVC");
  assert.equal(pedidoDeCaso("quero treinar dor no peito"), "IAM");
  assert.equal(pedidoDeCaso("revisar trauma pro plantão"), "TRAUMA");
  assert.equal(pedidoDeCaso("PCR"), "PCR");
  assert.equal(pedidoDeCaso("quero revisar parada cardíaca"), "PCR");
  assert.equal(pedidoDeCaso("convulsão"), "CONVULSAO");
  assert.equal(pedidoDeCaso("estudar tentativa de suicídio"), "PSIQ");
  assert.equal(pedidoDeCaso("caso de paciente agitado"), "PSIQ");
  for (const p of [
    "Consigo fechar minha meta?",
    "Quanto falta para fechar minha meta?",
    "Tem vaga liberada pra mim?",
    "Quero trocar um plantão: que trocas servem pra mim?",
    "Tem plantão extra aberto pra mim?",
    "Quais são meus próximos plantões?",
    "quero revisar minha escala",
    "nesse caso posso trocar sábado?",
  ]) assert.equal(pedidoDeCaso(p), undefined, p);
});

test("resposta só depois da tentativa, e quem personifica não conta como visto", () => {
  const rota = ler("src/app/api/intern/casos/route.ts");
  assert.match(rota, /tentativa: z\.string\(\)\.trim\(\)\.min\(TENTATIVA_MIN\)/);
  assert.match(rota, /if \(!user\.realUserId\) \{\s*await logAudit/);
  assert.match(ler("src/app/intern/luna/page.tsx"), new RegExp(`const TENTATIVA_MIN = ${TENTATIVA_MIN};`));
  assert.doesNotMatch(ler("src/lib/dai-temas.ts"), /dai-casos\.json/, "conteúdo não vai para o navegador");
});

test("fichas de plantão: uma por tema, tema conhecido, nenhum campo vazio", () => {
  const temas = new Set<string>(TEMAS.map((t) => t.tema));
  assert.deepEqual(FICHAS.map((f) => f.tema).sort(), ["AVC", "CONVULSAO", "IAM", "PCR", "PSIQ", "TRAUMA"]);
  for (const f of FICHAS) {
    assert.ok(temas.has(f.tema), f.tema);
    for (const campo of ["titulo", "em_30_segundos", "nao_pode_faltar", "armadilha", "referencia"] as const) assert.ok(f[campo].trim(), `${f.tema}.${campo}`);
  }
  assert.equal(fichaDoTema("SEPSE"), null);
});

test("tema com ficha abre pela ficha; caso só quando pede", () => {
  const rota = ler("src/app/api/intern/casos/route.ts");
  assert.match(rota, /if \(ficha && !pular && !req\.nextUrl\.searchParams\.has\("caso"\)\)/);
});
