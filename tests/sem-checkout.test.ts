/**
 * "O preceptor saiu sem fazer meu checkout" — nome, quando dá para registrar
 * e o texto que vai para a falta (src/lib/sem-checkout.ts).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { nomeDoPreceptor, nomeNaFrase, semCheckoutRegistravel, textoSemCheckout } from "../src/lib/sem-checkout";
import { AUTO_ABSENCE_CHECKOUT_NOTE } from "../src/shared/domain/policies/pending-attendance";

const base = { isExtraShift: false, checkinStatus: "VALIDATED", totpValidatedAt: "2026-11-17T10:05:00Z", checkoutAt: null, checkoutNotes: null, date: "2026-11-17", period: "DAY", shift: null };
const agora = new Date("2026-11-17T19:20:00-03:00");

test("nome do preceptor: sem título, com cara de nome", () => {
  assert.equal(nomeDoPreceptor("  Dr. João   Silva "), "João Silva");
  assert.equal(nomeDoPreceptor("dra Maria"), "Maria");
  assert.equal(nomeDoPreceptor("x"), null);
  assert.equal(nomeDoPreceptor("123"), null);
  assert.equal(nomeDoPreceptor(undefined), null);
});

test("nome na frase: só depois de Dr./preceptor/médico, com maiúscula", () => {
  assert.equal(nomeNaFrase("O Dr. João Silva saiu sem fazer meu checkout"), "João Silva");
  assert.equal(nomeNaFrase("a preceptora Ana de Souza foi embora sem checkout"), "Ana de Souza");
  assert.equal(nomeNaFrase("o preceptor saiu sem fazer meu checkout"), null);
  assert.equal(nomeNaFrase("o médico saiu sem checkout"), null);
});

test("registrável: check-in validado sem checkout, turno começado; ou falta automática", () => {
  assert.equal(semCheckoutRegistravel({ ...base, status: "CHECKED_IN" }, agora), true);
  assert.equal(semCheckoutRegistravel({ ...base, status: "CHECKED_IN", date: "2026-11-18" }, agora), false); // não começou
  assert.equal(semCheckoutRegistravel({ ...base, status: "CHECKED_IN", checkoutAt: "2026-11-17T22:00:00Z" }, agora), false);
  assert.equal(semCheckoutRegistravel({ ...base, status: "CHECKED_IN", isExtraShift: true }, agora), false);
  assert.equal(semCheckoutRegistravel({ ...base, status: "CHECKED_IN", totpValidatedAt: null }, agora), false);
  assert.equal(semCheckoutRegistravel({ ...base, status: "ABSENT", checkinStatus: "REJECTED", checkoutNotes: AUTO_ABSENCE_CHECKOUT_NOTE }, agora), true);
  assert.equal(semCheckoutRegistravel({ ...base, status: "ABSENT", checkinStatus: null, totpValidatedAt: null }, agora), false); // não veio
});

test("texto da falta: nome do médico e quando foi informado", () => {
  assert.equal(textoSemCheckout("João Silva", agora), "Preceptor João Silva saiu sem realizar o checkout. Informado pelo interno à Dai em 17/11, 19:20.");
});
