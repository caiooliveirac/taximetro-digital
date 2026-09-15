import test from "node:test";
import assert from "node:assert/strict";
import { celulaOcupavel, celulasDaBase, compararCodigoDeBase, horaDoTurno, mesmoEndereco, minutosDesdeInicioDoTurno, motivoDoRemanejamento, textoDoRemanejamento, vagasNaGrade } from "../src/lib/remanejamento-interno";
import { computePeriodLoad } from "../src/features/scheduling/domain/policies/assignment-policy";

test("vaga é de grade, não do limite físico", () => {
  assert.equal(vagasNaGrade(computePeriodLoad({ capacity: 2, occupied: 1 })), 1, "duas vagas, um interno");
  assert.equal(vagasNaGrade(computePeriodLoad({ capacity: 1, occupied: 0 })), 1, "uma vaga, ninguém");
  assert.equal(vagasNaGrade(computePeriodLoad({ capacity: 1, occupied: 1 })), 0, "cabe fisicamente, mas a grade está cheia");
  assert.equal(vagasNaGrade(computePeriodLoad({ capacity: 0, occupied: 0 })), 0, "base sem grade hoje não é vaga");
  assert.equal(vagasNaGrade(computePeriodLoad({ capacity: 1, occupied: 2 })), 0, "acima da grade nunca é negativo");
});

test("motivo vem do aviso; sem aviso reconhecido, é a pedido do interno", () => {
  assert.equal(motivoDoRemanejamento("SEM_MEDICO"), "sem médico na base");
  assert.equal(motivoDoRemanejamento(""), "a pedido do interno");
  assert.equal(motivoDoRemanejamento(undefined), "a pedido do interno");
});

test("texto do remanejamento: quem, de onde, para onde, quando, por quê", () => {
  assert.equal(
    textoDoRemanejamento({ interno: "Ana Souza", faculdade: "UNIFACS", de: "BR05", para: "SM01", hora: "19:12", motivo: "sem médico na base" }),
    "🔁 *Ana Souza* (UNIFACS) saiu da BR05 para a SM01 às 19:12: sem médico na base.",
  );
});

test("bases na ordem canônica: pelo número do código, sem número no fim", () => {
  const codes = ["CB02", "LF90", "SM01", "GOA", "PM40", "PR03", "BR05", "CN10"];
  assert.deepEqual(codes.sort(compararCodigoDeBase), ["SM01", "CB02", "PR03", "BR05", "CN10", "PM40", "LF90", "GOA"]);
});

test("células: ocupadas primeiro com o estado certo, livres depois, nunca negativas", () => {
  assert.deepEqual(
    celulasDaBase(3, [{ faculdade: "EBMSP", status: "CHECKED_IN" }, { faculdade: "Zarns", status: "SCHEDULED" }]),
    [
      { tipo: "ocupada", faculdade: "EBMSP", estado: "checkin-ok", reivindicavel: false },
      { tipo: "ocupada", faculdade: "Zarns", estado: "sem-checkin", reivindicavel: false },
      { tipo: "livre" },
    ],
  );
  assert.deepEqual(celulasDaBase(1, [{ faculdade: "A", status: "CONFIRMED" }, { faculdade: "B", status: "CHECKED_OUT" }]), [
    { tipo: "ocupada", faculdade: "A", estado: "sem-checkin", reivindicavel: false },
    { tipo: "ocupada", faculdade: "B", estado: "saiu", reivindicavel: false },
  ]);
  assert.deepEqual(celulasDaBase(0, []), []);
});

test("base bloqueada (aviso ou desativada) mantém quem está lá e não oferece livre", () => {
  assert.deepEqual(celulasDaBase(2, [{ faculdade: "AFYA", status: "SCHEDULED" }], { bloqueada: true, reivindicarSemCheckin: true }), [
    { tipo: "ocupada", faculdade: "AFYA", estado: "sem-checkin", reivindicavel: false },
  ]);
  assert.deepEqual(celulasDaBase(2, [], { bloqueada: true }), []);
});

test("base irmã: mesmo endereço no cadastro, com tolerância de arredondamento", () => {
  const br05 = { latitude: -12.981668, longitude: -38.43824 };
  assert.equal(mesmoEndereco(br05, { latitude: -12.98167, longitude: -38.438241 }), true);
  assert.equal(mesmoEndereco(br05, { latitude: -12.959059, longitude: -38.48784 }), false);
});

test("passada a tolerância, só a célula sem check-in vira reivindicável", () => {
  const celulas = celulasDaBase(
    2,
    [{ faculdade: "AFYA", status: "SCHEDULED" }, { faculdade: "UFBA", status: "CHECKED_IN" }],
    { reivindicarSemCheckin: true },
  );
  assert.deepEqual(celulas.map(celulaOcupavel), [true, false]);
  assert.equal(celulaOcupavel({ tipo: "livre" }), true);
});

test("minutos desde o início do turno: diurno às 07:00, noturno às 19:00, vira a meia-noite", () => {
  assert.equal(minutosDesdeInicioDoTurno("DAY", { hour: 7, minute: 12 }), 12);
  assert.equal(minutosDesdeInicioDoTurno("DAY", { hour: 6, minute: 50 }), -10, "antes do turno é negativo");
  assert.equal(minutosDesdeInicioDoTurno("NIGHT", { hour: 19, minute: 15 }), 15);
  assert.equal(minutosDesdeInicioDoTurno("NIGHT", { hour: 0, minute: 30 }), 330, "meia-noite e meia = 5h30 de turno");
  assert.equal(horaDoTurno("DAY", 10), "07:10");
  assert.equal(horaDoTurno("NIGHT", 15), "19:15");
});
