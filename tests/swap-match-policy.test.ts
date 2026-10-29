import test from "node:test";
import assert from "node:assert/strict";
import {
  avaliarOferta,
  janelaDeTrocas,
  resumoDaOferta,
  visivelPara,
  type ContextoDoMercado,
  type OfertaAberta,
  type PlantaoDoMercado,
  type SinalDoMercado,
} from "../src/shared/domain/policies/swap-match-policy";

const AGORA = new Date("2026-11-01T12:00:00-03:00");
const FAC_A = "fac-a";
const FAC_B = "fac-b";

function P(id: string, internId: string, date: string, period: "DAY" | "NIGHT", extra: Partial<PlantaoDoMercado> = {}): PlantaoDoMercado {
  return {
    id, internId, facultyId: FAC_A, date, period, shift: null,
    baseCode: "PP20", baseName: "Base Periperi", baseType: "USA", status: "SCHEDULED", isExtraShift: false,
    ...extra,
  };
}

function ctx(plantoes: PlantaoDoMercado[], sinais: SinalDoMercado[] = [], extra: Partial<ContextoDoMercado> = {}): ContextoDoMercado {
  return {
    agora: AGORA, plantoes, sinais, bloqueados: new Set(), cotaCruUsada: new Set(),
    nomes: new Map([["ana", "Ana Exemplo"], ["bruno", "Bruno Fictício"], ["carla", "Carla Modelo"]]),
    ...extra,
  };
}

// Ana tem noite 11/11 (colide com outro serviço 12/11 manhã) e oferta nada.
// Bruno oferta o diurno de 08/11 em Centenário.
const anaNoite = P("ana-sn", "ana", "2026-11-11", "NIGHT");
const anaOutro: SinalDoMercado = { internId: "ana", date: "2026-11-12", period: "DAY", signal: "OUTRO_SERVICO", label: "UPA" };
const brunoDia = P("bruno-sd", "bruno", "2026-11-08", "DAY", { baseName: "Base Centenário", baseCode: "CN10" });
const ofertaBruno: OfertaAberta = { requestId: "r1", plantao: brunoDia, nome: "Bruno Fictício", facultyAbbr: "A", criadaEm: "2026-10-31" };

test("troca perfeita: os dois marcaram o turno do outro, e ainda resolve a colisão", () => {
  const c = ctx([anaNoite, brunoDia], [
    anaOutro,
    { internId: "ana", date: "2026-11-08", period: "DAY", signal: "QUERO" },
    { internId: "bruno", date: "2026-11-11", period: "NIGHT", signal: "QUERO" },
  ]);
  const a = avaliarOferta(ofertaBruno, "ana", c);
  assert.equal(a.caixa, "PERFEITA");
  assert.equal(a.entregar?.id, "ana-sn");
  assert.match(a.motivo, /colide com seu outro serviço/);
});

test("combina quando só eu marquei; pode quando ninguém marcou", () => {
  const marcado = ctx([anaNoite, brunoDia], [{ internId: "ana", date: "2026-11-08", period: "DAY", signal: "POSSO" }]);
  assert.equal(avaliarOferta(ofertaBruno, "ana", marcado).caixa, "COMBINA");
  assert.equal(avaliarOferta(ofertaBruno, "ana", ctx([anaNoite, brunoDia])).caixa, "PODE");
});

test("troca só entre plantões do mesmo tipo", () => {
  const anaCru = P("ana-cru", "ana", "2026-11-11", "DAY", { baseType: "CENTRAL", baseName: "Central de Regulação" });
  const a = avaliarOferta(ofertaBruno, "ana", ctx([anaCru, brunoDia]));
  assert.equal(a.caixa, "FORA");
  assert.match(a.motivo, /não tem plantão de Ambulância/);
});

test("outra faculdade troca USA e CRU; CRL de outra faculdade nem aparece", () => {
  const cruBruno = P("bruno-cru", "bruno", "2026-11-08", "DAY", { baseType: "CENTRAL", facultyId: FAC_B });
  const crlBruno = P("bruno-crl", "bruno", "2026-11-08", "DAY", { baseType: "CRL", facultyId: FAC_B });
  assert.equal(visivelPara({ ...ofertaBruno, plantao: cruBruno }, "ana", new Set([FAC_A])), true);
  assert.equal(visivelPara({ ...ofertaBruno, plantao: crlBruno }, "ana", new Set([FAC_A])), false);
  assert.equal(visivelPara(ofertaBruno, "ana", new Set([FAC_B])), true);
});

test("CRU de outra faculdade entra na troca; CRL não", () => {
  const cruBruno = P("bruno-cru", "bruno", "2026-11-08", "DAY", { baseType: "CENTRAL", baseCode: "CRU", facultyId: FAC_B });
  const cruAna = P("ana-cru", "ana", "2026-11-15", "DAY", { baseType: "CENTRAL", baseCode: "CRU" });
  assert.notEqual(avaliarOferta({ ...ofertaBruno, plantao: cruBruno }, "ana", ctx([cruAna, cruBruno])).caixa, "FORA");

  const crlBruno = P("bruno-crl", "bruno", "2026-11-08", "DAY", { baseType: "CRL", baseCode: "CRL", facultyId: FAC_B });
  const crlAna = P("ana-crl", "ana", "2026-11-15", "DAY", { baseType: "CRL", baseCode: "CRL" });
  assert.equal(avaliarOferta({ ...ofertaBruno, plantao: crlBruno }, "ana", ctx([crlAna, crlBruno])).caixa, "FORA");
});

test("cota de CRU usada tira a oferta de CRU do alcance", () => {
  const cruBruno = P("bruno-cru", "bruno", "2026-11-08", "DAY", { baseType: "CENTRAL" });
  const cruAna = P("ana-cru", "ana", "2026-11-15", "DAY", { baseType: "CENTRAL" });
  const oferta = { ...ofertaBruno, plantao: cruBruno };
  const a = avaliarOferta(oferta, "ana", ctx([cruAna, cruBruno], [], { cotaCruUsada: new Set(["ana"]) }));
  assert.equal(a.caixa, "FORA");
  assert.match(a.motivo, /já trocou um plantão de CRU/);
});

test("turno colado num plantão meu: só dá entregando esse plantão", () => {
  const anaVizinha = P("ana-sn7", "ana", "2026-11-07", "NIGHT");
  const a = avaliarOferta(ofertaBruno, "ana", ctx([anaVizinha, brunoDia]));
  assert.equal(a.caixa, "SO_ENTREGANDO");
  assert.equal(a.entregar?.id, "ana-sn7");
});

test("descanso do outro lado: meu plantão não pode colar na escala de quem oferta", () => {
  // Bruno tem plantão no dia 12 de manhã: receber a noite de 11 da Ana colaria.
  const brunoDia12 = P("bruno-12", "bruno", "2026-11-12", "DAY");
  const a = avaliarOferta(ofertaBruno, "ana", ctx([anaNoite, brunoDia, brunoDia12]));
  assert.equal(a.caixa, "FORA");
  assert.match(a.motivo, /cabe na escala de Bruno/);
});

test("turno da oferta colado no meu outro serviço fica fora", () => {
  const outro7: SinalDoMercado = { internId: "ana", date: "2026-11-07", period: "NIGHT", signal: "OUTRO_SERVICO" };
  const a = avaliarOferta(ofertaBruno, "ana", ctx([anaNoite, brunoDia], [outro7]));
  assert.equal(a.caixa, "FORA");
  assert.match(a.motivo, /outro serviço/);
});

test("plantão já em outra solicitação não vira moeda de troca", () => {
  const a = avaliarOferta(ofertaBruno, "ana", ctx([anaNoite, brunoDia], [], { bloqueados: new Set(["ana-sn"]) }));
  assert.equal(a.caixa, "FORA");
});

test("resumo da oferta: conta quem consegue fechar e lista quem marcou", () => {
  const carla = P("carla-sd", "carla", "2026-11-20", "DAY");
  const c = ctx([anaNoite, brunoDia, carla], [
    anaOutro,
    { internId: "ana", date: "2026-11-08", period: "DAY", signal: "QUERO" },
    { internId: "carla", date: "2026-11-08", period: "DAY", signal: "POSSO" },
    { internId: "bruno", date: "2026-11-11", period: "NIGHT", signal: "QUERO" },
  ]);
  const r = resumoDaOferta(ofertaBruno, c, new Map([["ana", new Set([FAC_A])], ["carla", new Set([FAC_A])]]));
  assert.equal(r.podem, 2);
  assert.deepEqual(r.interessados.map((i) => [i.nome, i.sinal, i.perfeita]), [
    ["Ana Exemplo", "QUERO", true],
    ["Carla Modelo", "POSSO", false],
  ]);
});

test("janela conta ofertas e Quero/Posso por turno, e ignora outro serviço", () => {
  const j = janelaDeTrocas({
    de: "2026-11-08",
    dias: 2,
    ofertas: [ofertaBruno],
    sinais: [
      { internId: "ana", date: "2026-11-08", period: "DAY", signal: "QUERO" },
      { internId: "carla", date: "2026-11-08", period: "DAY", signal: "POSSO" },
      { internId: "ana", date: "2026-11-09", period: "DAY", signal: "OUTRO_SERVICO" },
    ],
  });
  assert.equal(j.length, 4);
  assert.deepEqual(j[0], { date: "2026-11-08", period: "DAY", ofertas: 1, procura: 2 });
  assert.equal(j[2].procura, 0);
});

test("base favorita sobe e base evitada desce dentro da caixa, sem mudar a caixa", () => {
  const favorita = ctx([anaNoite, brunoDia], [], { preferencias: new Map([["ana", new Map([["CN10", 1]])]]) });
  const evitada = ctx([anaNoite, brunoDia], [], { preferencias: new Map([["ana", new Map([["CN10", -1]])]]) });
  const neutra = avaliarOferta(ofertaBruno, "ana", ctx([anaNoite, brunoDia]));
  const a = avaliarOferta(ofertaBruno, "ana", favorita);
  const b = avaliarOferta(ofertaBruno, "ana", evitada);
  assert.equal(a.caixa, neutra.caixa);
  assert.equal(b.caixa, neutra.caixa);
  assert.ok(a.forca > neutra.forca && b.forca < neutra.forca);
  assert.match(a.motivo, /bases favoritas/);
  assert.match(b.motivo, /prefere evitar/);
});
