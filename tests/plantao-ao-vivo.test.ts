import test from "node:test";
import assert from "node:assert/strict";
import {
  avisoDaBase,
  avisoDoPlantao,
  ehReposicao,
  estadoDoTurno,
  horaDaReposicao,
  notaDeReposicao,
  semNotaDeReposicao,
  textoParaInternoRemanejado,
  textoParaInternoRepor,
  type EventoDoTurno,
} from "../src/lib/plantao-ao-vivo";

const aviso = (baseId: string, assignmentId: string, hora: string, codigo = "SEM_MEDICO"): EventoDoTurno => ({
  tipo: "AVISO",
  baseId,
  assignmentId,
  interno: "Ana",
  codigo,
  hora,
});

test("aviso cancelado pela coordenação some; aviso novo depois volta a valer", () => {
  const estado = estadoDoTurno([
    aviso("br05", "a1", "19:10"),
    { tipo: "AVISO_CANCELADO", baseId: "br05", hora: "19:20" },
  ]);
  assert.equal(avisoDaBase(estado.get("br05")), null);
  assert.equal(avisoDoPlantao(estado, "a1"), null, "o interno perde a grade");

  const de_novo = estadoDoTurno([
    aviso("br05", "a1", "19:10"),
    { tipo: "AVISO_CANCELADO", baseId: "br05", hora: "19:20" },
    aviso("br05", "a1", "19:31", "VIATURA"),
  ]);
  assert.deepEqual(avisoDaBase(de_novo.get("br05")), {
    assignmentId: "a1",
    interno: "Ana",
    codigo: "VIATURA",
    tipo: "problema na viatura",
    hora: "19:31",
  });
  assert.equal(avisoDoPlantao(de_novo, "a1")?.codigo, "VIATURA");
});

test("dois avisos na mesma base: o mais novo é o da tela, e o cancelamento derruba os dois", () => {
  const eventos = [aviso("br05", "a1", "19:10"), aviso("br05", "a2", "19:12", "SEM_ENFERMEIRO")];
  const estado = estadoDoTurno(eventos);
  assert.equal(estado.get("br05")?.avisos.length, 2);
  assert.equal(avisoDaBase(estado.get("br05"))?.hora, "19:12");
  assert.equal(avisoDoPlantao(estado, "a1")?.codigo, "SEM_MEDICO");

  const cancelado = estadoDoTurno([...eventos, { tipo: "AVISO_CANCELADO", baseId: "br05", hora: "19:20" }]);
  assert.equal(avisoDoPlantao(cancelado, "a1"), null);
  assert.equal(avisoDoPlantao(cancelado, "a2"), null);
});

test("aviso com código desconhecido ainda é aviso, com rótulo genérico", () => {
  const estado = estadoDoTurno([aviso("br05", "a1", "19:10", "OUTRO")]);
  assert.deepEqual(avisoDaBase(estado.get("br05")), { assignmentId: "a1", interno: "Ana", codigo: null, tipo: "problema na base", hora: "19:10" });
});

test("base parada pela coordenação fica parada até reabrir, e pode parar de novo", () => {
  const estado = estadoDoTurno([
    { tipo: "PARADA", baseId: "sm01", motivo: "  viatura na oficina ", hora: "08:00" },
  ]);
  assert.deepEqual(estado.get("sm01")?.parada, { desde: "08:00", motivo: "viatura na oficina" });

  const reaberta = estadoDoTurno([
    { tipo: "PARADA", baseId: "sm01", motivo: "", hora: "08:00" },
    { tipo: "REABERTA", baseId: "sm01", hora: "09:00" },
  ]);
  assert.equal(reaberta.get("sm01")?.parada, null);

  const outraVez = estadoDoTurno([
    { tipo: "PARADA", baseId: "sm01", motivo: null, hora: "08:00" },
    { tipo: "REABERTA", baseId: "sm01", hora: "09:00" },
    { tipo: "PARADA", baseId: "sm01", motivo: null, hora: "10:00" },
  ]);
  assert.deepEqual(outraVez.get("sm01")?.parada, { desde: "10:00", motivo: null });
});

test("parada e aviso são independentes na mesma base", () => {
  const estado = estadoDoTurno([
    aviso("br05", "a1", "19:10"),
    { tipo: "PARADA", baseId: "br05", motivo: "sem médico confirmado", hora: "19:15" },
    { tipo: "AVISO_CANCELADO", baseId: "br05", hora: "19:16" },
  ]);
  assert.equal(avisoDaBase(estado.get("br05")), null);
  assert.equal(estado.get("br05")?.parada?.motivo, "sem médico confirmado");
});

test("nota de reposição: marca, hora e desfazer", () => {
  const nota = notaDeReposicao({ baseCode: "BR05", hora: "19:40", motivo: "sem médico" });
  assert.equal(nota, "[REPOR] BR05 parada: sem médico. Liberado pela coordenação às 19:40 para repor em outro dia.");
  assert.equal(ehReposicao(nota), true);
  assert.equal(ehReposicao("Removido da escala pelo admin em 08/08/2026"), false);
  assert.equal(horaDaReposicao(nota), "19:40");

  assert.equal(notaDeReposicao({ baseCode: "BR05", hora: "19:40" }), "[REPOR] BR05 parada. Liberado pela coordenação às 19:40 para repor em outro dia.");

  const anterior = "[REMANEJADO] SM01 -> BR05 | Remanejamento pelo interno: sem médico na base";
  assert.equal(semNotaDeReposicao(`${anterior}\n${nota}`), anterior, "o desfazer preserva o que já estava na nota");
  assert.equal(semNotaDeReposicao(nota), null);
  assert.equal(semNotaDeReposicao(null), null);
});

test("textos para o interno no Telegram", () => {
  assert.equal(
    textoParaInternoRemanejado({ de: "BR05", para: "SM01", nomeDaBase: "Santa Mônica", motivo: "sem médico na base" }),
    "📍 A coordenação te remanejou da BR05 para a SM01 — Santa Mônica (sem médico na base). Se ainda não fez check-in, faça lá.",
  );
  assert.equal(
    textoParaInternoRepor({ baseCode: "BR05", motivo: null }),
    "🗓️ Seu plantão de hoje na BR05 foi liberado pela coordenação: a base parou e não há vaga em outra. Não conta como falta. Reponha em outro dia — as vagas abertas aparecem no app.",
  );
});

import { resumoDoTurnoParaTelegram, textoDaIntervencao } from "../src/lib/plantao-ao-vivo";

test("intervenção da coordenação contada para os outros coordenadores", () => {
  assert.equal(
    textoDaIntervencao("Caio", { acao: "mover", interno: "Ana Souza", faculdade: "UNIFACS", de: "BR05", para: "SM01", motivo: "sem médico na base" }, "19:20"),
    "🛠️ *Caio* (coordenação) moveu *Ana Souza* (UNIFACS) da BR05 para a SM01 às 19:20: sem médico na base.",
  );
  assert.equal(textoDaIntervencao("Caio", { acao: "pararBase", baseCode: "SM01", motivo: null }, "08:00"), "⛔ *Caio* (coordenação) parou a SM01 às 08:00.");
  assert.equal(
    textoDaIntervencao("Caio", { acao: "cancelarAviso", baseCode: "BR05", interno: "Ana Souza" }, "19:25"),
    "🛠️ *Caio* (coordenação) cancelou o aviso da BR05 às 19:25 (dado por Ana Souza): falso alarme.",
  );
});

test("resumo do turno para o /plantao: só o que precisa de atenção, mais as vagas", () => {
  const base = (code: string, livres: number, extra: Partial<Parameters<typeof resumoDoTurnoParaTelegram>[0]["bases"][number]> = {}) => ({
    code,
    aviso: null,
    parada: null,
    desativada: null,
    livres,
    ...extra,
  });
  const texto = resumoDoTurnoParaTelegram({
    period: "NIGHT",
    dataFormatada: "16/09",
    agora: "19:40",
    bases: [
      base("SM01", 0, { parada: { desde: "19:20", motivo: "viatura na oficina" } }),
      base("BR05", 0, { aviso: { assignmentId: "a1", interno: "Ana Souza", codigo: "SEM_MEDICO", tipo: "sem médico na base", hora: "19:12" } }),
      base("IT30", 1),
      base("CC70", 2),
    ],
    liberados: [{ interno: "Bia Lima", faculdade: "AFYA", baseCode: "PR03" }],
    url: "https://mnrs.com.br/taximetro/admin/plantao",
  });
  assert.equal(
    texto,
    [
      "🩺 *Plantão ao vivo* · noturno 16/09 · 19:40",
      "",
      "⛔ SM01 — parada pela coordenação às 19:20: viatura na oficina",
      "⚠️ BR05 — sem médico na base às 19:12 (Ana Souza)",
      "🗓️ Liberados para repor: Bia Lima (AFYA, PR03)",
      "🟢 Vagas na grade: IT30 1, CC70 2",
      "",
      "https://mnrs.com.br/taximetro/admin/plantao",
    ].join("\n"),
  );

  const calmo = resumoDoTurnoParaTelegram({ period: "DAY", dataFormatada: "16/09", agora: "09:00", bases: [base("SM01", 0)], liberados: [], url: "u" });
  assert.ok(calmo.includes("✅ Nenhum aviso, nenhuma base parada."));
  assert.ok(calmo.includes("🔴 Nenhuma vaga na grade."));
});
