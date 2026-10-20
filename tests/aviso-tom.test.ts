import test from "node:test";
import assert from "node:assert/strict";
import { avisoRepetido, textoDoAviso } from "../src/lib/aviso-tom";
import { readFileSync } from "node:fs";
import path from "node:path";

test("texto do aviso: quem, onde, quando, o quê — faculdade só quando existe", () => {
  assert.equal(
    textoDoAviso({ tipo: "SEM_MEDICO", interno: "Ana Souza", faculdade: "UNIFACS", baseCode: "BR05", hora: "19:12" }),
    "🧑‍⚕️ *Ana Souza* (UNIFACS) na BR05 às 19:12: sem médico na base.",
  );
  assert.equal(
    textoDoAviso({ tipo: "VIATURA", interno: "Ana Souza", faculdade: null, baseCode: "BR05", hora: "07:03" }),
    "🧑‍⚕️ *Ana Souza* na BR05 às 07:03: problema na viatura.",
  );
});

test("STAX-12: aviso na 2ª base em menos de 30 min não é engolido como repetição", () => {
  const ultimos = new Map<string, number>();
  const t0 = Date.UTC(2026, 9, 20, 22, 0);
  const minuto = 60_000;
  const naBase = (baseId: string) => ({ assignmentId: "a1", baseId, tipo: "SEM_MEDICO" });

  assert.equal(avisoRepetido(ultimos, naBase("br05"), t0), false, "1º aviso vale");
  assert.equal(avisoRepetido(ultimos, naBase("br05"), t0 + 5 * minuto), true, "mesma base: dedo tremeu");
  assert.equal(avisoRepetido(ultimos, naBase("sm01"), t0 + 10 * minuto), false, "remanejado: aviso novo na outra base");
  assert.equal(avisoRepetido(ultimos, { ...naBase("br05"), tipo: "VIATURA" }, t0 + 6 * minuto), false, "outro botão vale");
  assert.equal(avisoRepetido(ultimos, naBase("br05"), t0 + 31 * minuto), false, "passados 30 min, vale de novo");
});

test("STAX-12: a rota do aviso deduplica pela base do plantão", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/api/intern/aviso/route.ts"), "utf8");
  assert.match(src, /avisoRepetido\(ultimos, \{ assignmentId, baseId: plantao\.baseId, tipo \}, Date\.now\(\)\)/);
});
