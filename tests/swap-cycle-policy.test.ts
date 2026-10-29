import test from "node:test";
import assert from "node:assert/strict";
import { encontrarRodas, minhaPerna, montarRoda, problemaNaRoda } from "../src/shared/domain/policies/swap-cycle-policy";
import type { ContextoDoMercado, OfertaAberta, PlantaoDoMercado, SinalDoMercado } from "../src/shared/domain/policies/swap-match-policy";

const AGORA = new Date("2026-11-01T12:00:00-03:00");

function P(id: string, internId: string, date: string, period: "DAY" | "NIGHT", extra: Partial<PlantaoDoMercado> = {}): PlantaoDoMercado {
  return { id, internId, facultyId: "fac-a", date, period, shift: null, baseCode: "PP20", baseName: "Base Periperi", baseType: "USA", status: "SCHEDULED", isExtraShift: false, ...extra };
}

function ctx(plantoes: PlantaoDoMercado[], sinais: SinalDoMercado[] = [], extra: Partial<ContextoDoMercado> = {}): ContextoDoMercado {
  return {
    agora: AGORA, plantoes, sinais, bloqueados: new Set(), cotaCruUsada: new Set(),
    nomes: new Map([["ana", "Ana Exemplo"], ["bruno", "Bruno Fictício"], ["carla", "Carla Modelo"]]),
    ...extra,
  };
}

const oferta = (p: PlantaoDoMercado, nome: string): OfertaAberta => ({ requestId: `r-${p.id}`, plantao: p, nome, facultyAbbr: null, criadaEm: "2026-10-31" });

// Ana sai do dia 10 (oferta), Bruno sai do dia 14 (oferta), Carla sai do dia 18 (colide com outro serviço).
const pa = P("pa", "ana", "2026-11-10", "DAY", { baseName: "Base Cabula" });
const pb = P("pb", "bruno", "2026-11-14", "DAY", { baseName: "Base Paralela" });
const pc = P("pc", "carla", "2026-11-18", "NIGHT", { baseName: "Base Itapoã" });
const carlaOutro: SinalDoMercado = { internId: "carla", date: "2026-11-19", period: "DAY", signal: "OUTRO_SERVICO" };
const brunoQuerA: SinalDoMercado = { internId: "bruno", date: "2026-11-10", period: "DAY", signal: "QUERO" };
const carlaQuerB: SinalDoMercado = { internId: "carla", date: "2026-11-14", period: "DAY", signal: "POSSO" };

test("montarRoda: cada um recebe o plantão de quem está antes na roda", () => {
  const r = montarRoda([pa, pb, pc]);
  assert.deepEqual(r.map((x) => [x.internId, x.recebe.id]), [["ana", "pc"], ["bruno", "pa"], ["carla", "pb"]]);
});

test("acha a roda de Ana, Bruno e Carla, com Ana sem ter pedido o dia de Carla", () => {
  const c = ctx([pa, pb, pc], [carlaOutro, brunoQuerA, carlaQuerB]);
  const rodas = encontrarRodas(c, [oferta(pa, "Ana Exemplo"), oferta(pb, "Bruno Fictício")]);
  assert.equal(rodas.length, 1);
  assert.equal(rodas[0].sinalizadas, 2);
  const ana = minhaPerna(rodas[0], "ana", c)!;
  assert.equal(ana.recebe.id, "pc");
  assert.equal(ana.pediu, false);
});

test("com as três pernas pedidas, a roda conta 3 e aparece uma vez só", () => {
  const anaQuerC: SinalDoMercado = { internId: "ana", date: "2026-11-18", period: "NIGHT", signal: "QUERO" };
  const rodas = encontrarRodas(ctx([pa, pb, pc], [carlaOutro, brunoQuerA, carlaQuerB, anaQuerC]), [oferta(pa, "Ana"), oferta(pb, "Bruno")]);
  assert.equal(rodas.length, 1);
  assert.equal(rodas[0].sinalizadas, 3);
});

test("sem alguém precisar sair, não há roda", () => {
  // Carla não ofertou nem tem colisão: o dia 18 dela não é saída.
  const rodas = encontrarRodas(ctx([pa, pb, pc], [brunoQuerA, carlaQuerB]), [oferta(pa, "Ana"), oferta(pb, "Bruno")]);
  assert.equal(rodas.length, 0);
});

test("o descanso vale no resultado final: Ana com plantão colado no dia de Carla quebra a roda", () => {
  const anaVizinho = P("pa2", "ana", "2026-11-19", "DAY");
  const c = ctx([pa, pb, pc, anaVizinho], [carlaOutro, brunoQuerA, carlaQuerB]);
  assert.match(problemaNaRoda(montarRoda([pa, pb, pc]), c, new Set())!, /Ana ficaria sem 12h de descanso/);
  assert.equal(encontrarRodas(c, [oferta(pa, "Ana"), oferta(pb, "Bruno")]).length, 0);
});

test("tipos diferentes, cota de CRU e plantão em outra troca barram a roda", () => {
  const cruC = { ...pc, baseType: "CENTRAL" };
  assert.match(problemaNaRoda(montarRoda([pa, pb, cruC]), ctx([pa, pb, cruC]))!, /mesmo tipo/);

  const [ca, cb, cc] = [pa, pb, pc].map((p) => ({ ...p, baseType: "CENTRAL" }));
  assert.match(problemaNaRoda(montarRoda([ca, cb, cc]), ctx([ca, cb, cc], [], { cotaCruUsada: new Set(["bruno"]) }))!, /Bruno já trocou um plantão de CRU/);

  const travado = ctx([pa, pb, pc], [], { bloqueados: new Set(["pb"]) });
  assert.match(problemaNaRoda(montarRoda([pa, pb, pc]), travado)!, /já está em outra troca/);
  assert.equal(problemaNaRoda(montarRoda([pa, pb, pc]), travado, new Set(["pb"])), null);
});

test("Leitos não roda entre faculdades; ambulância roda", () => {
  const [la, lb, lc] = [pa, pb, { ...pc, facultyId: "fac-b" }].map((p) => ({ ...p, baseType: "CRL" }));
  assert.match(problemaNaRoda(montarRoda([la, lb, lc]), ctx([la, lb, lc]))!, /só troca dentro da faculdade/);
  const outraFac = { ...pc, facultyId: "fac-b" };
  assert.equal(problemaNaRoda(montarRoda([pa, pb, outraFac]), ctx([pa, pb, outraFac])), null);
});
