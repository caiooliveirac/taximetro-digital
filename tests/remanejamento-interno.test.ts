import test from "node:test";
import assert from "node:assert/strict";
import { celulaOcupavel, celulasDaBase, compararCodigoDeBase, horaDoTurno, mesmoEndereco, minutosDesdeInicioDoTurno, motivoDoRemanejamento, participaDoRemanejamento, textoDoRemanejamento, vagasNaGrade } from "../src/lib/remanejamento-interno";
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

test("cada não-comparecimento libera uma vaga só, e a livre vai primeiro", () => {
  const r = { reivindicarSemCheckin: true };
  const semCheckin = { faculdade: "AFYA", status: "SCHEDULED" };
  const chegou = { faculdade: "EBMSP", status: "SCHEDULED", remanejado: true };

  // livre existe: a do sem check-in fica fechada
  assert.deepEqual(celulasDaBase(2, [semCheckin], r).map(celulaOcupavel), [false, true]);
  // dois sem check-in, base cheia: as duas abrem
  assert.deepEqual(celulasDaBase(2, [semCheckin, semCheckin], r).map(celulaOcupavel), [true, true]);
  // um já chegou remanejado: sobra uma
  assert.deepEqual(celulasDaBase(2, [semCheckin, semCheckin, chegou], r).map(celulaOcupavel), [true, false, false]);
  // dois chegaram: fecha, mesmo com os dois sem check-in ainda na grade
  assert.deepEqual(celulasDaBase(2, [semCheckin, semCheckin, chegou, chegou], r).map(celulaOcupavel), [false, false, false, false]);
  // quem chegou remanejado aparece como tal, não como não-comparecimento
  const [primeira] = celulasDaBase(2, [chegou], r);
  assert.equal(primeira.tipo === "ocupada" ? primeira.estado : null, "remanejado");
});

test("minutos desde o início do turno: diurno às 07:00, noturno às 19:00, vira a meia-noite", () => {
  assert.equal(minutosDesdeInicioDoTurno("DAY", { hour: 7, minute: 12 }), 12);
  assert.equal(minutosDesdeInicioDoTurno("DAY", { hour: 6, minute: 50 }), -10, "antes do turno é negativo");
  assert.equal(minutosDesdeInicioDoTurno("NIGHT", { hour: 19, minute: 15 }), 15);
  assert.equal(minutosDesdeInicioDoTurno("NIGHT", { hour: 0, minute: 30 }), 330, "meia-noite e meia = 5h30 de turno");
  assert.equal(horaDoTurno("DAY", 10), "07:10");
  assert.equal(horaDoTurno("NIGHT", 15), "19:15");
});

test("LF90 fica fora do remanejamento; as demais participam", () => {
  assert.equal(participaDoRemanejamento("LF90"), false);
  assert.equal(participaDoRemanejamento("SM01"), true);
});

test("vaga além da grade: base de uma vaga cabe dois, e quem pode usar depende da hora e da irmã", () => {
  const ocupado = [{ faculdade: "EBMSP", status: "CHECKED_IN" }];
  const extra = (podeUsar: boolean, reservadaPara: string | null = null) => ({ limite: 2, podeUsar, reservadaPara });

  // antes dos 15 min, outro interno: a extra aparece, mas fechada
  assert.deepEqual(celulasDaBase(1, ocupado, { extra: extra(false, "BR60") }).map(celulaOcupavel), [false, false]);
  // o interno da irmã pode, mesmo antes dos 15 min
  assert.deepEqual(celulasDaBase(1, ocupado, { extra: extra(true, "BR60") }).map(celulaOcupavel), [false, true]);
  // depois dos 15 min sem reserva: qualquer um
  assert.deepEqual(celulasDaBase(1, ocupado, { reivindicarSemCheckin: true, extra: extra(true) }).map(celulaOcupavel), [false, true]);
  // grade de dois não tem extra
  assert.equal(celulasDaBase(2, ocupado, { reivindicarSemCheckin: true, extra: extra(true) }).length, 2);
  // sem grade hoje, sem extra
  assert.equal(celulasDaBase(0, [], { reivindicarSemCheckin: true, extra: extra(true) }).length, 0);
  // base bloqueada não oferece a extra
  assert.deepEqual(celulasDaBase(1, ocupado, { bloqueada: true, extra: extra(true) }).map(celulaOcupavel), [false, false]);
});

test("vaga além da grade respeita o limite físico junto com a reivindicação", () => {
  const r = { reivindicarSemCheckin: true, extra: { limite: 2, podeUsar: true, reservadaPara: null } };
  const semCheckin = { faculdade: "AFYA", status: "SCHEDULED" };
  const chegou = { faculdade: "UFBA", status: "SCHEDULED", remanejado: true };
  // um sem check-in numa grade de um: a dele e a extra abrem (cabem dois de verdade)
  assert.deepEqual(celulasDaBase(1, [semCheckin], r).map(celulaOcupavel), [true, true]);
  // chegou um remanejado: a grade de um já está tomada por ele, sobra só o lugar físico extra
  assert.deepEqual(celulasDaBase(1, [semCheckin, chegou], r).map(celulaOcupavel), [false, false, true]);
  // chegaram dois: fecha tudo, e o sem check-in continua visível
  assert.deepEqual(celulasDaBase(1, [semCheckin, chegou, chegou], r).map(celulaOcupavel), [false, false, false, false]);
});
