/**
 * Isolamento entre instâncias.
 *
 * A garantia que estes testes dão: se alguém ligar sem querer no SAMU uma
 * funcionalidade que é só da Vitalmed (ou vazar branding de uma na outra), o
 * `npm test` quebra antes de virar deploy. É a rede de segurança da tabela em
 * src/lib/instance.ts — que só vale enquanto ninguém puder mexer nela calado.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  INSTANCIAS,
  featuresDe,
  temFeature,
  temEscala,
  escalasDaInstancia,
  resolverInstancia,
} from "../src/lib/instance";
import { brandingDe } from "../src/lib/branding";

test("SAMU não tem sorteio no admin nem indisponibilidade do interno", () => {
  // Estas duas são explicitamente exclusivas da Vitalmed, por decisão do produto.
  assert.equal(temFeature("adminLottery", "samu"), false);
  assert.equal(temFeature("internUnavailability", "samu"), false);
});

test("Vitalmed tem sorteio no admin e indisponibilidade do interno", () => {
  assert.equal(temFeature("adminLottery", "vitalmed"), true);
  assert.equal(temFeature("internUnavailability", "vitalmed"), true);
});

test("toda feature está declarada em todas as instâncias", () => {
  // Sem isto, uma feature nova declarada só na Vitalmed viraria `undefined` no
  // SAMU — que é falsy, funciona por acidente, e para de funcionar no dia em que
  // alguém inverter a condição.
  const chaves = INSTANCIAS.map((i) => Object.keys(featuresDe(i)).sort());
  for (const lista of chaves) {
    assert.deepEqual(lista, chaves[0], "instâncias declaram conjuntos diferentes de features");
  }
  for (const instancia of INSTANCIAS) {
    for (const [nome, valor] of Object.entries(featuresDe(instancia))) {
      assert.equal(typeof valor, "boolean", `${instancia}.${nome} não é booleano`);
    }
  }
});

test("escalas: SAMU tem CRL, Vitalmed não", () => {
  assert.equal(temEscala("crl", "samu"), true);
  assert.equal(temEscala("crl", "vitalmed"), false);

  // Os rótulos são do cliente; os slugs (rotas) são compartilhados.
  assert.deepEqual(
    escalasDaInstancia("samu").map((e) => e.label),
    ["Escala USA", "Escala CRU", "Escala CRL"],
  );
  assert.deepEqual(
    escalasDaInstancia("vitalmed").map((e) => e.label),
    ["Escala APH", "Escala CCO"],
  );
});

test("branding de uma instância não vaza para a outra", () => {
  const samu = brandingDe("samu");
  const vitalmed = brandingDe("vitalmed");

  const textoVitalmed = JSON.stringify(vitalmed).toLowerCase();
  assert.equal(textoVitalmed.includes("samu"), false, "branding da Vitalmed menciona SAMU");

  const textoSamu = JSON.stringify(samu).toLowerCase();
  assert.equal(textoSamu.includes("vitalmed"), false, "branding do SAMU menciona Vitalmed");

  // Nenhum par de instâncias pode compartilhar domínio, ícone ou grupo de
  // Telegram — compartilhar qualquer um destes é vazamento de uma na outra.
  assert.notEqual(samu.baseUrl, vitalmed.baseUrl);
  assert.notEqual(samu.icones.i192, vitalmed.icones.i192);
  assert.notEqual(samu.icones.i512, vitalmed.icones.i512);
  assert.notEqual(samu.og.url, vitalmed.og.url);
  assert.notEqual(samu.telegramGroupLink, vitalmed.telegramGroupLink);
});

test("sem NEXT_PUBLIC_ORG, ou com valor inválido, a instância é SAMU", () => {
  // O build oficial do SAMU não passa a variável. Se o padrão virasse Vitalmed
  // um dia, o SAMU sairia no ar com o branding do cliente errado. Um valor
  // errado de digitação também precisa cair no SAMU, e não em outra coisa.
  assert.equal(resolverInstancia(undefined), "samu");
  assert.equal(resolverInstancia(""), "samu");
  assert.equal(resolverInstancia("   "), "samu");
  assert.equal(resolverInstancia("vitalmedd"), "samu");
  assert.equal(resolverInstancia("SAMU"), "samu");
  assert.equal(resolverInstancia("Vitalmed"), "vitalmed");
  assert.equal(resolverInstancia(" vitalmed "), "vitalmed");
});

test("link de cadastro do preceptor não vaza de uma instância na outra", () => {
  // O SAMU tem link próprio; a Vitalmed ainda não tem, e null suprime a dica.
  // Mandar preceptor da Vitalmed se cadastrar no mnrs.com.br seria vazamento
  // de instância — e foi o que aconteceria ao migrar a Vitalmed para o master
  // sem esta tabela (a URL era constante hardcoded no webhook).
  const samu = brandingDe("samu").preceptorRegistrationUrl;
  assert.ok(samu && samu.includes("mnrs.com.br"));
  assert.equal(brandingDe("vitalmed").preceptorRegistrationUrl, null);
});
