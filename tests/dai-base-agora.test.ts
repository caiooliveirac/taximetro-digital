/**
 * "Estou na base tal, vai ativar?" — resposta pronta pelo quadro de médicos
 * do `plantoes`, sem modelo. Hora fixa em cada caso: o texto muda antes do
 * turno, na tolerância (até HH:15) e depois dela.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { baseETurno, inicioDoTurno, textoDaBaseAgora, turnoDoRelogio, turnoPedido } from "../src/lib/luna-base-agora";
import { rotear } from "../src/lib/luna-roteador";
import type { MeuPlantao } from "../src/lib/luna-inteligencia";

const dia = { date: "2026-10-30", period: "DAY" as const };
const as = (hhmm: string, date = "2026-10-30") => new Date(`${date}T${hhmm}:00-03:00`);
const sit = (s: Partial<{ consultado: boolean; chegaram: { nome: string; desde: string }[]; saindo: { nome: string; desde: string }[]; desativada: { desde: string | null; motivo: string | null } | null }>) =>
  ({ consultado: true, chegaram: [], saindo: [], desativada: null, ...s });

test("médico do turno já chegou: diz quem procurar", () => {
  const t = textoDaBaseAgora({ baseCode: "CB02", turno: dia, now: as("07:20"), situacao: sit({ chegaram: [{ nome: "Ana Lima", desde: "07:12" }] }) });
  assert.match(t, /^Sim: Dr\(a\)\. Ana Lima já chegou na CB02 \(às 07:12\) para o turno das 07:00\. Procure por ele\(a\)\./);
});

test("ninguém chegou e há médico de saída: procurar quem sai; antes de 07:15, espera", () => {
  const t = textoDaBaseAgora({ baseCode: "CB02", turno: dia, now: as("07:05"), situacao: sit({ saindo: [{ nome: "Bruno Reis", desde: "19:02" }] }) });
  assert.match(t, /Ninguém do turno das 07:00 registrou chegada na CB02/);
  assert.match(t, /Quem está de saída é Dr\(a\)\. Bruno Reis: procure por ele\(a\) e pergunte quem assume\./);
  assert.match(t, /Se ninguém chegar até 07:15: no card do plantão \(aba Hoje\) toque em Avisar → Sem médico; depois disso, na aba Check-in, escolha outra base livre\./);
});

test("depois de 07:15 sem ninguém: avisar Sem médico e escolher outra base", () => {
  const t = textoDaBaseAgora({ baseCode: "PM04", turno: dia, now: as("07:40"), situacao: sit({}) });
  assert.match(t, /Também não há médico de saída na base\./);
  assert.match(t, /Já passou das 07:15: se está mesmo sem médico, no card do plantão \(aba Hoje\) toque em Avisar → Sem médico/);
});

test("noturno: tolerância é 19:15", () => {
  const t = textoDaBaseAgora({ baseCode: "CB02", turno: { date: "2026-10-30", period: "NIGHT" }, now: as("19:30"), situacao: sit({}) });
  assert.match(t, /turno das 19:00/);
  assert.match(t, /Já passou das 19:15/);
});

test("base desativada no quadro: não vai ativar, remanejar", () => {
  const t = textoDaBaseAgora({ baseCode: "BR05", turno: dia, now: as("08:40"), situacao: sit({ desativada: { desde: "08:31", motivo: "viatura na oficina" } }) });
  assert.match(t, /A BR05 está desativada no quadro dos médicos desde 08:31 \(viatura na oficina\)\. Não vai ativar por agora/);
});

test("antes do turno: ainda não começou, mostra quem está na base", () => {
  const t = textoDaBaseAgora({ baseCode: "CB02", turno: { date: "2026-10-30", period: "NIGHT" }, now: as("17:30"), situacao: sit({ saindo: [{ nome: "Ana Lima", desde: "07:12" }] }) });
  assert.match(t, /^CB02, sex 30\/10 noite:/);
  assert.match(t, /Na base agora está Dr\(a\)\. Ana Lima, do turno anterior/);
  assert.match(t, /Perto das 19:00 do dia, pergunte de novo/);
});

test("sem canal com o plantoes: diz que não sabe e orienta o aviso", () => {
  const t = textoDaBaseAgora({ baseCode: "CB02", turno: dia, now: as("07:05"), situacao: sit({ consultado: false }) });
  assert.match(t, /^Não consegui ver agora o quadro dos médicos/);
  assert.match(t, /até 07:15/);
});

const meu = (date: string, period: "DAY" | "NIGHT", baseCode: string): MeuPlantao => ({
  id: `${date}${period}`, date, period, shift: null, baseCode, tipo: "USA", status: "SCHEDULED", isExtraShift: false,
  justificativa: false, checkinStatus: null, totpValidatedAt: null, checkoutAt: null, checkoutNotes: null,
});

test("base e turno: a citada; senão o plantão dele mais perto; senão o relógio", () => {
  const meus = [meu("2026-10-30", "DAY", "CB02"), meu("2026-10-31", "NIGHT", "PM04")];
  assert.deepEqual(baseETurno(meus, as("06:40"), null), { baseCode: "CB02", turno: dia });
  assert.deepEqual(baseETurno(meus, as("06:40"), "PR03"), { baseCode: "PR03", turno: dia });
  // Plantão dele na base citada, mesmo de noite: usa o turno dele.
  assert.deepEqual(baseETurno(meus, as("17:30", "2026-10-31"), "PM04"), { baseCode: "PM04", turno: { date: "2026-10-31", period: "NIGHT" } });
  assert.deepEqual(baseETurno([], as("10:00"), null), { baseCode: null, turno: dia });
  assert.deepEqual(turnoDoRelogio(as("03:00")), { date: "2026-10-29", period: "NIGHT" });
  assert.equal(inicioDoTurno({ date: "2026-10-30", period: "NIGHT" }).toISOString(), "2026-10-30T22:00:00.000Z");
});

test("roteador: 'vai ativar?' vai direto, mesmo com 'noite' na frase", () => {
  for (const q of ["Estou na base CB02, vai ativar?", "tem médico na base?", "o médico já chegou?", "A Cabula vai ativar hoje à noite?", "to na base e ta sem medico"]) {
    assert.equal(rotear(q)?.tipo, "BASE_AGORA", q);
  }
  assert.notEqual(rotear("Quais são meus próximos plantões?")?.tipo, "BASE_AGORA");
});

const prev = (nomes: string[], diaSemEscala = false) => ({ consultado: true, diaSemEscala, nomes });

test("turno futuro: médico previsto pela escala; furo; dia sem escala publicada", () => {
  const noite = { date: "2026-10-31", period: "NIGHT" as const };
  assert.match(
    textoDaBaseAgora({ baseCode: "CB02", turno: noite, now: as("10:00"), situacao: sit({}), previstos: prev(["Ana L."]) }),
    /^CB02, sáb 31\/10 noite: Pela escala médica, o previsto é Dr\(a\)\. Ana L\. Perto das 19:00 do dia, pergunte de novo/,
  );
  assert.match(
    textoDaBaseAgora({ baseCode: "CB02", turno: noite, now: as("10:00"), situacao: sit({}), previstos: prev([]) }),
    /não tem ninguém previsto na CB02 nesse turno: sem médico escalado, ela pode não ativar/,
  );
  // Dia sem nenhuma base na escala = escala não publicada, não furo.
  assert.match(
    textoDaBaseAgora({ baseCode: "CB02", turno: noite, now: as("10:00"), situacao: sit({}), previstos: prev([], true) }),
    /Não consegui ver a escala médica desse turno/,
  );
});

test("turno de agora sem chegada: mostra também o previsto pela escala", () => {
  const t = textoDaBaseAgora({ baseCode: "CB02", turno: dia, now: as("07:05"), situacao: sit({}), previstos: prev(["Ana L."]) });
  assert.match(t, /Pela escala médica, o previsto é Dr\(a\)\. Ana L\./);
});

test("turno pedido na pergunta: amanhã, dia da semana, data, noite", () => {
  const agora = as("10:00", "2026-10-29"); // quinta
  assert.deepEqual(turnoPedido("vai ativar amanhã?", agora), { date: "2026-10-30", period: "DAY" });
  assert.deepEqual(turnoPedido("e amanhã à noite?", agora), { date: "2026-10-30", period: "NIGHT" });
  assert.deepEqual(turnoPedido("sábado vai ativar?", agora), { date: "2026-10-31", period: "DAY" });
  assert.deepEqual(turnoPedido("quinta que vem?", agora), { date: "2026-11-05", period: "DAY" });
  assert.deepEqual(turnoPedido("dia 03/11 noite", agora), { date: "2026-11-03", period: "NIGHT" });
  assert.deepEqual(turnoPedido("hoje à noite", agora), { date: "2026-10-29", period: "NIGHT" });
  assert.equal(turnoPedido("vai ativar?", agora), null);
});

test("sem plantão perto, 'minha base vai ativar?' olha o próximo plantão dele", () => {
  const meus = [meu("2026-11-03", "NIGHT", "SM01")];
  assert.deepEqual(baseETurno(meus, as("10:00", "2026-10-29"), null), { baseCode: "SM01", turno: { date: "2026-11-03", period: "NIGHT" } });
});
