/**
 * Perguntas de regra e de app com frase real do audit_log (DAI_PERGUNTA,
 * 29/10 a 17/11). Saem direto, sem modelo, com o texto fixo de luna-regras.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rotear } from "../src/lib/luna-roteador";

const HOJE = "2026-11-18";
const chave = (q: string) => {
  const r = rotear(q, HOJE);
  return r?.tipo === "REGRA" ? r.chave : r?.tipo ?? null;
};

test("horário do turno: direto, sem ir à situação da base", () => {
  for (const q of ["que horas é o fim do turno", "Que horas é CRL?", "qual horas devo chegar para regulação de leitos?", "Que horas inicia CRU?"]) {
    assert.equal(chave(q), "HORARIO", q);
  }
  const r = rotear("Que horas inicia CRU?", HOJE);
  assert.ok(r?.tipo === "REGRA" && /diurno das 7h às 19h\*\* e \*\*noturno das 19h às 7h/.test(r.texto));
});

test("justificativa e abono: quem avalia, onde justificar, sem inventar prazo", () => {
  for (const q of ["Quanto tempo é avaliada a justificativa", "Quando abonam?"]) assert.equal(chave(q), "JUSTIFICATIVA", q);
  const r = rotear("Quando abonam?", HOJE);
  assert.ok(r?.tipo === "REGRA" && /coordenação, que pode abonar/.test(r.texto) && /não marca prazo/.test(r.texto));
});

test("comprovante e histórico: o app não emite; aponta Histórico e Ocorrências", () => {
  for (const q of [
    "Tem como eu ter um documento físico da comprovação dos meus plantões ou do histórico deles?",
    "como eu consigo acessarmeu histórico de plantões com as ocorrências clínicas que eu registrei?",
    "Onde está o histórico do dia 22/07/2026?",
  ]) assert.equal(chave(q), "COMPROVANTE", q);
});

test("app: calendário do celular e instalar", () => {
  assert.equal(chave("Tenho como sincronizar os plantões com meu calendário?"), "CALENDARIO");
  assert.equal(chave("tem aplicativo?"), "INSTALAR");
});

test("largar x trocar, 'a minha é substituída?' e 'vira extra?'", () => {
  assert.equal(chave("Largar seria trocar??"), "LARGAR_TROCAR");
  assert.equal(chave("Daí, se eu clicar pegar nessas bases de amanhã SD disponíveis a minha é substituído por esse"), "SUBSTITUI");
  assert.equal(chave("Daí se eu me inscrever em algum plantão, com 4 usa pra fazer ele se torna extra ou entra na carga horária"), "CONTA_OU_EXTRA");
});

test("sorteio: hora e resultado", () => {
  assert.equal(chave("Quero saber quais opções eu ganhei no sorteio da repescagem que participei"), "SORTEIO");
  assert.equal(chave("Meu extra do sorteio da repescagem"), "SORTEIO");
});

test("'cliquei em pedir e não apareceu' é a solicitação dele", () => {
  assert.equal(chave('Cliquei em "pedir" e não apareceu'), "SOLICITACOES");
});

test("o que não é regra continua no caminho de antes", () => {
  assert.equal(chave("Tem vaga liberada pra mim?"), "BUSCA");
  assert.equal(chave("tem extra ou vaga liberada amanhã?"), "BUSCA");
  assert.equal(chave("que horas o médico chega na CB02?"), null);
  assert.equal(chave("Não vou conseguir ir pra um plantão"), "LIBERAR");
  assert.equal(chave("quero largar e trocar meu plantão de sexta"), null);
  assert.equal(chave("Tenho solicitações que fiz a certo tempo e não analisaram"), "SOLICITACOES");
});
