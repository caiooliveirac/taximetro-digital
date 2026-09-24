import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { lerTokenFederado } from "../src/lib/federacao-portal";

const SEGREDO = "s".repeat(48);
const T0 = 1_800_000_000;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(claims: Record<string, unknown>, segredo = SEGREDO, alg = "HS256") {
  const cab = b64({ alg, typ: "JWT" });
  const corpo = b64(claims);
  return `${cab}.${corpo}.${createHmac("sha256", segredo).update(`${cab}.${corpo}`).digest("base64url")}`;
}
const valido = { tipo: "escala-handoff", origem: "plantoes", sub: "Interno@Exemplo.test", aud: "taximetro", iat: T0, exp: T0 + 60 };

test("portal: aceita o handoff e normaliza o e-mail", () => {
  assert.equal(lerTokenFederado(token(valido), SEGREDO, T0 + 5), "interno@exemplo.test");
});

test("portal: recusa audiência, tipo, chave, alg, vencido e malformado", () => {
  assert.equal(lerTokenFederado(token({ ...valido, aud: "almoxarifado" }), SEGREDO, T0), null);
  assert.equal(lerTokenFederado(token({ ...valido, tipo: "outro" }), SEGREDO, T0), null);
  assert.equal(lerTokenFederado(token(valido, "x".repeat(48)), SEGREDO, T0), null);
  assert.equal(lerTokenFederado(token(valido, SEGREDO, "none"), SEGREDO, T0), null);
  assert.equal(lerTokenFederado(token(valido), SEGREDO, T0 + 61), null);
  assert.equal(lerTokenFederado("a.b", SEGREDO, T0), null);
});

test("portal: desligado sem segredo (Vitalmed, dev)", () => {
  assert.equal(lerTokenFederado(token(valido), undefined, T0), null);
});
