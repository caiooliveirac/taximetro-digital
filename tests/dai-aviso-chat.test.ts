/**
 * Avisos da Dai no chat: o novo substitui o não lido do mesmo tipo, e o texto
 * leva link de um toque para a tela onde se resolve.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { substituicoes } from "../src/features/dai-avisos/remetente";
import { partesDaLinha, semMarcacao } from "../src/lib/texto-do-chat";

const ler = (arquivo: string) => readFileSync(path.join(process.cwd(), arquivo), "utf8");
const em = (h: number) => new Date(Date.UTC(2026, 10, 17, h));

test("aviso novo substitui o último não lido do mesmo tipo para a mesma pessoa", () => {
  const naoLidas = [
    { id: "m1", para: "ana", action: "DAI_AVISO_REPESCAGEM", em: em(8) },
    { id: "m2", para: "ana", action: "DAI_AVISO_REPESCAGEM", em: em(11) },
    { id: "m3", para: "ana", action: "DAI_AVISO_VAGAS", em: em(8) },
    { id: "m4", para: "bia", action: "DAI_AVISO_TROCAS", em: em(8) },
  ];
  assert.deepEqual(
    substituicoes([
      { para: "ana", action: "DAI_AVISO_REPESCAGEM" },
      { para: "ana", action: "DAI_AVISO_SORTEIO_ANUNCIO" },
      { para: "bia", action: "DAI_AVISO_REPESCAGEM" },
      { para: "bia", action: "DAI_AVISO_TROCAS" },
    ], naoLidas),
    ["m2", null, null, null],
  );
});

test("dois avisos do mesmo tipo na mesma rodada: só o primeiro substitui", () => {
  const naoLidas = [{ id: "m1", para: "ana", action: "DAI_AVISO_SORTEIO_ANUNCIO", em: em(8) }];
  assert.deepEqual(
    substituicoes([{ para: "ana", action: "DAI_AVISO_SORTEIO_ANUNCIO" }, { para: "ana", action: "DAI_AVISO_SORTEIO_ANUNCIO" }], naoLidas),
    ["m1", null],
  );
});

test("chat: negrito e link só para tela do app", () => {
  assert.deepEqual(partesDaLinha("Sorteio **15h**: [inscreva-se](/intern/extras) já."), [
    { tipo: "texto", texto: "Sorteio " },
    { tipo: "negrito", texto: "15h" },
    { tipo: "texto", texto: ": " },
    { tipo: "link", texto: "inscreva-se", href: "/intern/extras" },
    { tipo: "texto", texto: " já." },
  ]);
  assert.deepEqual(partesDaLinha("[pedir](/intern/luna?atalho=vaga-liberada)"), [{ tipo: "link", texto: "pedir", href: "/intern/luna?atalho=vaga-liberada" }]);
  for (const fora of ["[x](https://exemplo.com)", "[x](//exemplo.com)", "[x](javascript:alert(1))", "[x](/admin/usuarios)"]) {
    assert.ok(partesDaLinha(fora).every((p) => p.tipo === "texto"), fora);
  }
  assert.equal(semMarcacao("Sorteio **15h**: [inscreva-se](/intern/extras)."), "Sorteio 15h: inscreva-se.");
});

test("todo link de aviso aponta para atalho que existe na aba Dai", () => {
  const chaves = [...ler("src/app/intern/luna/page.tsx").matchAll(/chave: "([\w-]+)"/g)].map((m) => m[1]);
  const usados = [...ler("src/features/dai-avisos/textos.ts").matchAll(/\?atalho=([\w-]+)/g)].map((m) => m[1]);
  assert.ok(usados.length > 0);
  for (const u of usados) assert.ok(chaves.includes(u), u);
});
