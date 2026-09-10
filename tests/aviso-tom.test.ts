import test from "node:test";
import assert from "node:assert/strict";
import { textoDoAviso } from "../src/lib/aviso-tom";

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
