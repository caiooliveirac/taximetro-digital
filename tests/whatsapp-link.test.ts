import { test } from "node:test";
import assert from "node:assert/strict";
import { whatsappLink } from "../src/lib/whatsapp";

test("whatsappLink: celular com DDD ganha DDI 55", () => {
  assert.equal(whatsappLink("(71) 99876-5432"), "https://wa.me/5571998765432");
  assert.equal(whatsappLink("7133334444"), "https://wa.me/557133334444");
});

test("whatsappLink: já com DDI 55 mantém", () => {
  assert.equal(whatsappLink("+55 71 99876-5432"), "https://wa.me/5571998765432");
});

test("whatsappLink: vazio ou curto não vira link", () => {
  assert.equal(whatsappLink(null), null);
  assert.equal(whatsappLink(""), null);
  assert.equal(whatsappLink("998765432"), null);
});
