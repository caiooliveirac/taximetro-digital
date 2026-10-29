/**
 * Avaliação da Luna por perguntas reais, com fixture determinística e modelo
 * falso. Para cada pergunta confere: dado certo, cruzamento certo (meta,
 * descanso, dia bloqueado, tipo), nada inventado, e quantas vezes o modelo
 * foi chamado — a meta é 0 no caminho direto e 1 no resto.
 *
 * Hoje na fixture: qui 29/10/2026. Rodízio até 30/11. Faltam 2 USA e 1 CRL.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Fontes, LunaCtx } from "../src/lib/luna-dados";
import type { Fila } from "../src/features/extra-offers/application/fila-de-reposicao";
import type { SituacaoDoTurno } from "../src/features/scheduling/infra/repositories/plantoes-medicos-repository";
import type { MedicosPrevistos } from "../src/features/scheduling/infra/repositories/escala-medica-repository";
import { sanearArgs, type LunaMemoria } from "../src/lib/luna-ferramentas";
import { perguntarLuna, type LunaPergunta } from "../src/lib/luna-interno";
import { explicarPlantao, textoDaPresenca, type Meta, type MeuPlantao, type Oferta } from "../src/lib/luna-inteligencia";
import { rotear } from "../src/lib/luna-roteador";

const HOJE = "2026-10-29";
const ctx: LunaCtx = { internId: "eu", facultyId: "fac-a", hoje: HOJE };

const meu = (id: string, date: string, period: "DAY" | "NIGHT", tipo: MeuPlantao["tipo"], baseCode: string, extra: Partial<MeuPlantao> = {}): MeuPlantao => ({
  id, date, period, shift: null, baseCode, tipo, status: "SCHEDULED", isExtraShift: false, justificativa: false,
  checkinStatus: null, totpValidatedAt: null, checkoutAt: null, checkoutNotes: null, ...extra,
});
const oferta = (fonte: Oferta["fonte"], id: string, tipo: Oferta["tipo"], date: string, period: "DAY" | "NIGHT", extra: Partial<Oferta> = {}): Oferta => ({
  fonte, id, baseCode: id, tipo, date, period, shift: null, ...extra,
});

const META: Meta = { faculdade: "FAC-A", inicio: "2026-10-01", fim: "2026-11-30", alvo: { USA: 8, CRU: 4, CRL: 4 }, faltam: { USA: 2, CRU: 0, CRL: 1 }, realizados: 9, faltas: 1 };
const MEUS: MeuPlantao[] = [
  meu("p3", "2026-10-20", "DAY", "USA", "EXT1", { status: "CHECKED_OUT", isExtraShift: true }),
  meu("p2", "2026-10-25", "DAY", "CRL", "CRL", { status: "ABSENT" }),
  meu("p1", "2026-10-27", "DAY", "USA", "CB02", { status: "CHECKED_IN", checkinStatus: "VALIDATED", totpValidatedAt: "2026-10-27T10:00:00Z" }),
  meu("p4", "2026-10-30", "NIGHT", "USA", "PM04"),
  meu("p5", "2026-10-31", "DAY", "USA", "CB02"),
  meu("p6", "2026-11-03", "DAY", "CRU", "CENTRAL"),
];
const LIBERADAS: Oferta[] = [
  oferta("LIBERADA", "IT30", "USA", "2026-10-31", "NIGHT", { faculdade: "FAC-B" }), // colada no sáb dia
  oferta("LIBERADA", "SA01", "USA", "2026-11-02", "NIGHT", { faculdade: "FAC-B" }), // colada na ter dia (CRU)
  oferta("LIBERADA", "CB05", "USA", "2026-11-05", "NIGHT", { faculdade: "FAC-C" }),
  oferta("LIBERADA", "CRUX", "CRU", "2026-11-06", "DAY", { faculdade: "FAC-B" }), // CRU já completo
  oferta("LIBERADA", "CRL4", "CRL", "2026-11-04", "DAY", { faculdade: "FAC-C" }),
  oferta("LIBERADA", "CB07", "USA", "2026-11-10", "DAY", { faculdade: "FAC-B" }),
];
const EXTRAS: Oferta[] = [
  oferta("EXTRA", "PM01", "USA", "2026-11-07", "DAY"),
  oferta("EXTRA", "CRLE", "CRL", "2026-10-30", "DAY"), // colada na sex noite
];
const GRADE: Oferta[] = [oferta("GRADE", "CRLG", "CRL", "2026-11-01", "NIGHT")];
const TROCAS: Oferta[] = [
  oferta("TROCA", "T1", "USA", "2026-11-01", "DAY", { quem: "Bruna Alves", quemId: "u-b", assignmentId: "a-t1", faculdade: "FAC-B" }),
  oferta("TROCA", "T2", "CRU", "2026-11-04", "DAY", { quem: "Caio Lima", quemId: "u-c", assignmentId: "a-t2", faculdade: "FAC-A" }),
  oferta("TROCA", "T3", "USA", "2026-10-31", "NIGHT", { quem: "Davi Reis", quemId: "u-d", assignmentId: "a-t3", faculdade: "FAC-A" }),
];

type Fixture = { meta?: Meta | null; meus?: MeuPlantao[]; liberadas?: Oferta[]; extras?: Oferta[]; grade?: Oferta[]; trocas?: Oferta[]; fila?: Fila; situacao?: SituacaoDoTurno; previstos?: MedicosPrevistos; falha?: string };

// Números de 29/10/2026: a demanda passa da oferta em todo tipo.
const FILA: Fila = { USA: { precisam: 131, casinhas: 611, vagasAbertas: 43 }, CRU: { precisam: 112, casinhas: 356, vagasAbertas: 0 }, CRL: { precisam: 60, casinhas: 60, vagasAbertas: 0 } };

function fontes(fx: Fixture = {}) {
  const lidas: string[] = [];
  const le = <T>(nome: string, v: T) => async () => {
    lidas.push(nome);
    if (fx.falha === nome) throw new Error("banco caiu");
    return v;
  };
  const f: Fontes = {
    meta: le("meta", fx.meta === undefined ? META : fx.meta),
    meusPlantoes: le("meus", fx.meus ?? MEUS),
    fila: le("fila", fx.fila ?? FILA),
    bases: le("bases", [{ code: "CB02", name: "Base Cabula" }, { code: "PM04", name: "Base Pituba" }, { code: "PR03", name: "Base Periperi" }]),
    situacaoDoTurno: async (codigo, inicio) => {
      lidas.push(`plantoes:${codigo}:${inicio.toISOString()}`);
      return fx.situacao ?? { consultado: true, chegaram: [], saindo: [], desativada: null };
    },
    medicosPrevistos: async () => fx.previstos ?? { consultado: true, diaSemEscala: false, porBase: { CB02: ["Carla M."] } },
    lider: le("lider", { id: "lider-a", nome: "Líder A" }),
    liberadas: async (ate) => (await le("liberadas", fx.liberadas ?? LIBERADAS)()).filter((o) => o.date <= ate),
    extras: le("extras", fx.extras ?? EXTRAS),
    grade: le("grade", fx.grade ?? GRADE),
    trocas: le("trocas", fx.trocas ?? TROCAS),
    // Lado do colega: o Davi já tem plantão domingo de manhã.
    conferirTroca: async (o) => (o.id === "T3" ? "Não dá para fazer essa troca: Davi Reis ficaria com dois plantões seguidos, sem 12h de descanso." : null),
  };
  return { f, lidas };
}

type Passo = { tool?: { name: string; args: Record<string, unknown> }; texto?: string };

function modelo(passos: Passo[]) {
  const corpos: { messages: { role: string; content: string }[]; tools: unknown[] }[] = [];
  const fake = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    corpos.push(body);
    const p = passos[corpos.length - 1] ?? { texto: "?" };
    const message = p.tool
      ? { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: p.tool.name, arguments: JSON.stringify(p.tool.args) } }] }
      : { role: "assistant", content: p.texto };
    return new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: Math.round(init.body.length / 4), completion_tokens: 30 } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fake, corpos };
}

async function perguntar(texto: string, opts: { passos?: Passo[]; fx?: Fixture; antes?: LunaPergunta[] } = {}) {
  const m = modelo(opts.passos ?? []);
  const { f, lidas } = fontes(opts.fx);
  const logs: Record<string, unknown>[] = [];
  const r = await perguntarLuna(ctx, [...(opts.antes ?? []), { role: "user", content: texto }], (o) => logs.push(o), { fontes: f, fetch: m.fetch });
  const log = logs.find((l) => l.ev === "luna_interno")!;
  return { r, chamadas: m.corpos.length, corpos: m.corpos, log, lidas };
}

// ---------------------------------------------------------------------------
// Caminho direto: zero chamadas ao modelo.

test("1. 'Quanto falta para eu terminar?' — meta está na tela Início: sem modelo e sem consulta", async () => {
  const { r, chamadas, log, lidas } = await perguntar("Quanto falta para eu terminar?");
  assert.equal(chamadas, 0);
  assert.equal(log.rota, "direta");
  assert.deepEqual(lidas, []);
  assert.match(r.texto, /tela \*\*Início\*\*/);
  assert.doesNotMatch(r.texto, /Faltam/);
});

test("2. 'Tenho algum plantão amanhã?' — direto, só amanhã", async () => {
  const { r, chamadas } = await perguntar("Tenho algum plantão amanhã?");
  assert.equal(chamadas, 0);
  assert.match(r.texto, /amanhã/);
  assert.match(r.texto, /PM04 sex 30\/10 noite/);
  assert.doesNotMatch(r.texto, /CB02/);
  assert.equal(r.cartoes[0].tipo, "plantoes");
});

test("8. 'Tenho checkout pendente?' — direto, aponta o plantão e quem resolve", async () => {
  const { r, chamadas } = await perguntar("Tenho checkout pendente?");
  assert.equal(chamadas, 0);
  assert.match(r.texto, /Checkout pendente em 1/); // 27/10 dia: prazo passou
  assert.match(r.texto, /CB02 ter 27\/10 dia/);
  assert.match(r.texto, /1 sem justificativa/);
});

test("'Consigo fechar minha meta?' — direto: plano que cobre o que falta, sem descanso quebrado", async () => {
  const { r, chamadas, lidas } = await perguntar("Consigo fechar minha meta?");
  assert.equal(chamadas, 0);
  assert.match(r.texto, /Dá para fechar até 30\/11/);
  assert.doesNotMatch(r.texto, /Faltam/);
  // Plano: a CRL da grade (dom) + as duas USA que cabem; nada colado na agenda.
  assert.match(r.texto, /1\. \*\*CRLG dom 01\/11 noite\*\*/);
  assert.match(r.texto, /2\. \*\*CB05 qui 05\/11 noite\*\*/);
  assert.match(r.texto, /3\. \*\*CB07 ter 10\/11 dia\*\*/);
  assert.doesNotMatch(r.texto, /IT30|SA01|CRUX|CRLE/);
  assert.match(r.texto, /extra.* não conta para a meta/);
  assert.deepEqual(r.memoria?.opcoes?.slice(0, 3).map((o) => o.id), ["CRLG", "CB05", "CB07"]);
  // Cada fonte lida uma vez só.
  assert.equal(lidas.filter((x) => x === "meus").length, 1);
});

// ---------------------------------------------------------------------------
// Uma chamada ao modelo: ele só traduz o pedido em parâmetros.

test("avaliação real 29/10: 'dessas' sem lista anterior não inventa número", async () => {
  const { r } = await perguntar("Quais dessas vagas ainda estão abertas?", { passos: [{ tool: { name: "buscar_opcoes", args: { objetivo: "meta", opcoes: [7] } } }] });
  assert.match(r.texto, /não trouxe uma lista numerada/);
});

test("avaliação real 29/10: troca nunca oferece o mesmo turno do plantão que ele quer largar", async () => {
  const mesmo = oferta("TROCA", "TX", "USA", "2026-10-31", "DAY", { quem: "Colega", quemId: "u-x", assignmentId: "a-x" });
  const { r } = await perguntar("Quero trocar minha USA de sábado", {
    fx: { trocas: [mesmo, ...TROCAS] },
    passos: [{ tool: { name: "buscar_opcoes", args: { objetivo: "troca", trocar_data: "2026-10-31" } } }],
  });
  assert.doesNotMatch(r.texto, /TX sáb/);
  assert.match(r.texto, /no mesmo turno do seu plantão/);
});

test("avaliação real 29/10: meta toda completa responde curto, sem lista de descarte nem fila", async () => {
  const { r } = await perguntar("Que vagas fecham minha meta?", { fx: { meta: { ...META, faltam: { USA: 0, CRU: 0, CRL: 0 } } } });
  assert.match(r.texto, /^Sua meta já está toda marcada/);
  assert.doesNotMatch(r.texto, /Deixei de fora|reposição/);
});

test("prompt: plantão que ele já tem não vira bloqueio; fim de semana vira preferência; regra sem ferramenta", () => {
  const src = readFileSync(path.join(process.cwd(), "src/lib/luna-interno.ts"), "utf8");
  assert.match(src, /Plantão que ele já tem NÃO entra/);
  assert.match(src, /"Fim de semana" = prefere_dias_semana sex, sab, dom/);
  assert.match(src, /Pergunta de regra/);
});

test("'Estou na Cabula, vai ativar?' — direto, base pelo nome, médico que chegou", async () => {
  const { r, chamadas, lidas } = await perguntar("Estou na Cabula, vai ativar?", {
    fx: { situacao: { consultado: true, chegaram: [{ nome: "Ana Lima", desde: "07:12" }], saindo: [], desativada: null } },
  });
  assert.equal(chamadas, 0);
  assert.match(r.texto, /Dr\(a\)\. Ana Lima já chegou na CB02/);
  assert.ok(lidas.some((l) => l.startsWith("plantoes:CB02:")));
});

test("'A Cabula vai ativar no dia 30/12 à noite?' — turno futuro: médico previsto pela escala", async () => {
  const { r, chamadas, lidas } = await perguntar("A Cabula vai ativar no dia 30/12 à noite?", {
    previstos: undefined,
    fx: { previstos: { consultado: true, diaSemEscala: false, porBase: { CB02: ["Carla M."] } } },
  } as never);
  assert.equal(chamadas, 0);
  assert.match(r.texto, /^CB02, qua 30\/12 noite: Pela escala médica, o previsto é Dr\(a\)\. Carla M\./);
  assert.ok(lidas.some((l) => l.startsWith("plantoes:CB02:2026-12-30T22")));
});

test("critério final: 2 USA, não posso seg nem qua, prefiro noite, já tenho sexta", async () => {
  const { r, chamadas, corpos } = await perguntar(
    "Faltam duas USA na minha meta, não posso segunda nem quarta, prefiro noturno e já tenho um plantão sexta. O que você consegue encontrar para mim?",
    { passos: [{ tool: { name: "buscar_opcoes", args: { objetivo: "meta", tipos: ["USA"], nao_posso: [{ dia_semana: "seg" }, { dia_semana: "qua" }], prefere_periodo: "noite" } } }] },
  );
  assert.equal(chamadas, 1);
  assert.match(r.texto, /Dá para fechar/);
  assert.doesNotMatch(r.texto, /CRL/); // pediu só USA
  assert.match(r.texto, /1\. \*\*CB05 qui 05\/11 noite\*\*/); // noite primeiro
  assert.match(r.texto, /2\. \*\*CB07 ter 10\/11 dia\*\*/);
  assert.doesNotMatch(r.texto, /SA01|IT30/);
  assert.match(r.texto, /Deixei de fora 2: 1 sem 12h de descanso, 1 em dia que você não pode/);
  // O resumo foi junto no prompt: o modelo não precisa de ferramenta para a agenda.
  // Meta não vai no prompt (está na tela Início); a agenda vai.
  assert.doesNotMatch(corpos[0].messages[0].content, /"faltam"/);
  assert.match(corpos[0].messages[0].content, /RESUMO: .*"proximos"/);
  assert.equal(corpos[0].tools.length, 4);
});

test("3. 'Quais vagas posso pegar sem prejudicar meu descanso?' — direto, descanso conferido", async () => {
  const { r, chamadas } = await perguntar("Quais vagas posso pegar sem prejudicar meu descanso?");
  assert.equal(chamadas, 0);
  assert.doesNotMatch(r.texto, /IT30|SA01|CRLE/);
  assert.match(r.texto, /sem 12h de descanso/);
});

test("4. 'Quero trocar minha USA de sábado' — troca bilateral, lado do colega conferido", async () => {
  const { r, chamadas } = await perguntar("Quero trocar minha USA de sábado", {
    passos: [{ tool: { name: "buscar_opcoes", args: { objetivo: "troca", trocar_data: "2026-10-31" } } }],
  });
  assert.equal(chamadas, 1);
  assert.match(r.texto, /Para largar seu \*\*CB02 sáb 31\/10 dia\*\*/);
  assert.match(r.texto, /1\. \*\*T1 dom 01\/11 dia\*\* \(USA\) · troca com Bruna Alves/);
  assert.doesNotMatch(r.texto, /2\. /); // T3 barrada pelo descanso do Davi, T2 é CRU
  assert.match(r.texto, /1 barradas pelo lado do colega/);
  assert.doesNotMatch(r.texto, /Davi/); // a agenda do colega não vaza na lista
  assert.equal(r.cartoes[0].itens[0].acao, "Conversar");
});

test("5. 'Algum colega pode trocar comigo?' — direto, só troca do mesmo tipo que dá para oferecer", async () => {
  const { r, chamadas } = await perguntar("Algum colega pode trocar comigo?");
  // "colega" pede interpretação: vai ao modelo, que chama a busca de troca.
  assert.equal(chamadas, 1, "sem passo roteirizado o modelo responde texto");
  assert.ok(r.texto);
  const { r: r2 } = await perguntar("Algum colega pode trocar comigo?", { passos: [{ tool: { name: "buscar_opcoes", args: { objetivo: "troca" } } }] });
  assert.match(r2.texto, /T1/);
  assert.match(r2.texto, /você daria o/);
});

test("lista de trocas longa: cada oferta aparece uma vez só", async () => {
  const muitas = Array.from({ length: 9 }, (_, i) => oferta("TROCA", `TX${i}`, "USA", `2026-11-${String(10 + i).padStart(2, "0")}`, "NIGHT", { quem: `Colega ${i}`, quemId: `u${i}`, assignmentId: `a${i}` }));
  const { r } = await perguntar("Quero trocar um plantão: que trocas servem pra mim?", { fx: { trocas: muitas } });
  const ids = r.memoria!.opcoes!.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 5);
  assert.match(r.texto, /\(\+4 outras compatíveis\)/);
});

test("6. 'Tenho prova terça e não posso fazer plantão segunda à noite' — bloqueio respeitado", async () => {
  const { r } = await perguntar("Tenho prova terça e não posso fazer plantão segunda à noite. O que tem pra mim?", {
    passos: [{ tool: { name: "buscar_opcoes", args: { objetivo: "plantao", nao_posso: [{ dia_semana: "seg", periodo: "noite" }, { dia_semana: "ter" }], dias: 21 } } }],
  });
  assert.doesNotMatch(r.texto, /SA01|CB07/); // seg noite e ter
  assert.match(r.texto, /CB05/);
});

test("7. 'Minha meta fecha mesmo com uma falta?' — vai ao modelo com o resumo, sem ferramenta", async () => {
  const { chamadas, corpos, log } = await perguntar("Minha meta fecha mesmo com uma falta?", { passos: [{ texto: "Falta não ocupa casinha…" }] });
  assert.equal(chamadas, 1);
  assert.equal(log.rota, "modelo");
  assert.match(corpos[0].messages[0].content, /tela Início/);
});

test("9. 'Por que meu plantão não contou na meta?' — explica cada um", async () => {
  const { r, chamadas } = await perguntar("Por que meu plantão não contou na meta?", { passos: [{ tool: { name: "explicar_plantao", args: {} } }] });
  assert.equal(chamadas, 1);
  assert.match(r.texto, /EXT1 .*extra não conta/);
  assert.match(r.texto, /CRL dom 25\/10 dia: ficou como falta/);
  assert.match(r.texto, /CB02 ter 27\/10 dia: o prazo do checkout passou/);
});

test("10. 'Encontre a melhor opção para completar minhas CRL'", async () => {
  const { r } = await perguntar("Encontre a melhor opção para completar minhas CRL", { passos: [{ tool: { name: "buscar_opcoes", args: { objetivo: "meta", tipos: ["CRL"] } } }] });
  assert.match(r.texto, /Dá para fechar/);
  assert.match(r.texto, /1\. \*\*CRLG dom 01\/11 noite\*\*/);
  assert.doesNotMatch(r.texto, /USA\)/);
});

test("12. 'Posso pegar vaga mesmo já tendo completado a meta?' — liberada não; extra sim", async () => {
  const completa: Meta = { ...META, faltam: { USA: 0, CRU: 0, CRL: 0 } };
  const { r, lidas } = await perguntar("Posso pegar uma vaga mesmo já tendo completado minha meta?", {
    fx: { meta: completa },
    passos: [{ tool: { name: "buscar_opcoes", args: { objetivo: "plantao" } } }],
  });
  assert.doesNotMatch(r.texto, /liberada por/);
  assert.match(r.texto, /PM01 .*extra/);
  // Nem busca vaga liberada: diz quem está na frente.
  assert.ok(!lidas.includes("liberadas"));
  assert.match(r.texto, /Vaga liberada vai primeiro para quem precisa de reposição \(hoje: 131 em USA, 112 em CRU, 60 em CRL\)/);
  assert.match(r.texto, /Candidatura abre quando sobrar vaga/);
  assert.ok(!r.cartoes.some((c) => c.itens.some((i) => i.candidatar)));
});

test("meta completa e sobra vaga livre depois da fila: candidatura, a coordenação decide", async () => {
  const completa: Meta = { ...META, faltam: { USA: 0, CRU: 0, CRL: 0 } };
  const sobra: Fila = { ...FILA, USA: { precisam: 2, casinhas: 3, vagasAbertas: 9 } };
  const { r, chamadas } = await perguntar("Tem vaga liberada pra mim?", { fx: { meta: completa, fila: sobra } });
  assert.equal(chamadas, 0);
  assert.match(r.texto, /Sobra vaga livre de USA: como sua meta está completa, você se candidata/);
  assert.match(r.texto, /CB05 .*candidatura: a coordenação decide/);
  assert.doesNotMatch(r.texto, /CRUX|CRL4/); // CRU e CRL seguem na fila
  const item = r.cartoes[0].itens.find((i) => i.titulo.includes("CB05"))!;
  assert.equal(item.candidatar, "CB05");
  assert.equal(item.acao, "Me candidatar");
});

test("meta completa só num tipo: vaga liberada dos outros tipos continua", async () => {
  const { r, lidas } = await perguntar("Tem vaga liberada pra mim?", { fx: { meta: { ...META, faltam: { USA: 2, CRU: 0, CRL: 0 } } } });
  assert.ok(lidas.includes("liberadas"));
  assert.match(r.texto, /CB05/);
  assert.doesNotMatch(r.texto, /reposição/);
});

// ---------------------------------------------------------------------------
// Memória da conversa: referência estruturada, revalidada contra o banco.

async function primeiraLista() {
  const { r } = await perguntar("Consigo fechar minha meta?");
  return [{ role: "user", content: "Consigo fechar minha meta?" }, { role: "assistant", content: r.texto, memoria: r.memoria }] as LunaPergunta[];
}

test("11/'E a segunda opção?' — reavalia o id guardado, não o texto", async () => {
  const antes = await primeiraLista();
  const { r, corpos } = await perguntar("E a segunda opção?", { antes, passos: [{ tool: { name: "buscar_opcoes", args: { opcoes: [2] } } }] });
  assert.match(corpos[0].messages[0].content, /ÚLTIMA LISTA: 1=grade, 2=liberada/);
  // Mantém o número da lista original e a memória dela: "a primeira" segue sendo a CRLG.
  assert.match(r.texto, /2\. \*\*CB05 qui 05\/11 noite\*\*/);
  assert.doesNotMatch(r.texto, /CRLG|CB07/);
  assert.deepEqual(r.memoria?.opcoes?.map((o) => o.n), antes[1].memoria?.opcoes?.map((o) => o.n));
});

test("'Quais dessas ainda estão abertas?' — a que foi pega aparece como fechada", async () => {
  const antes = await primeiraLista();
  const { r } = await perguntar("Quais dessas vagas ainda estão abertas?", {
    antes,
    fx: { liberadas: LIBERADAS.filter((l) => l.id !== "CB05") },
    passos: [{ tool: { name: "buscar_opcoes", args: { opcoes: [1, 2, 3] } } }],
  });
  assert.match(r.texto, /não está mais aberta/);
  assert.doesNotMatch(r.texto, /CB05/);
  assert.match(r.texto, /CB07/);
});

test("'Tem uma mais perto do fim de semana?' — refina a última busca", async () => {
  const antes = await primeiraLista();
  const { r, corpos } = await perguntar("Tem uma mais perto do fim de semana?", {
    antes,
    passos: [{ tool: { name: "buscar_opcoes", args: { objetivo: "meta", tipos: ["USA"], prefere_dias_semana: ["sex", "sab", "dom"] } } }],
  });
  assert.match(corpos[0].messages[0].content, /ÚLTIMA BUSCA: \{"objetivo":"meta"\}/);
  assert.match(r.texto, /\*\*CB05/);
});

test("'E se eu trocar a de sábado pela de domingo?' — avaliação bilateral de um par", async () => {
  const { r: lista } = await perguntar("Quero trocar um plantão: que trocas servem pra mim?");
  const antes: LunaPergunta[] = [{ role: "user", content: "Quero trocar" }, { role: "assistant", content: lista.texto, memoria: lista.memoria }];
  const ok = await perguntar("E se eu trocar a de sábado pela primeira?", { antes, passos: [{ tool: { name: "avaliar_troca", args: { meu_plantao_data: "2026-10-31", opcao: 1 } } }] });
  assert.match(ok.r.texto, /Dá para propor: você entrega o \*\*CB02 sáb 31\/10 dia\*\* e fica com o \*\*T1 dom 01\/11 dia\*\*/);
  assert.match(ok.r.texto, /Só vale quando Bruna confirmar/);
  const cru = await perguntar("E pela de CRU?", { antes, passos: [{ tool: { name: "avaliar_troca", args: { meu_plantao_data: "2026-10-31", oferta_data: "2026-11-04" } } }] });
  assert.match(cru.r.texto, /Não dá .*troca é do mesmo tipo/);
});

// ---------------------------------------------------------------------------
// Confiabilidade e isolamento.

test("consulta que falha não vira 'não tem nada'", async () => {
  const { r, chamadas } = await perguntar("Tem plantão extra aberto pra mim?", { fx: { falha: "extras" } });
  assert.equal(chamadas, 0);
  assert.equal(r.erro, true);
  assert.match(r.texto, /não vou chutar/);
});

test("sem meta: a busca diz que não sabe, não inventa", async () => {
  const { r } = await perguntar("Consigo fechar minha meta?", { fx: { meta: null } });
  assert.match(r.texto, /Não consegui achar sua meta/);
});

test("o modelo não escolhe de quem é o dado: campos desconhecidos caem fora", () => {
  const a = sanearArgs({ internId: "outro", facultyId: "outra", objetivo: "meta", tipos: ["USA", "XYZ"], dias: 999, opcoes: [1, "drop table"], nao_posso: [{ dia_semana: "sábado" }, { lixo: 1 }] });
  assert.deepEqual(a, { objetivo: "meta", tipos: ["USA"], dias: 45, opcoes: [1], nao_posso: [{ dia_semana: "sábado" }] });
});

test("id forjado na memória não mostra oferta alheia: só vale o que está na lista do próprio interno", async () => {
  const forjada: LunaMemoria = { opcoes: [{ n: 1, fonte: "LIBERADA", id: "vaga-de-outro" }] };
  const { r } = await perguntar("Essa ainda está aberta?", { antes: [{ role: "assistant", content: "…", memoria: forjada }], passos: [{ tool: { name: "buscar_opcoes", args: { opcoes: [1] } } }] });
  assert.match(r.texto, /não está mais aberta/);
  assert.doesNotMatch(r.texto, /vaga-de-outro/);
});

test("observabilidade: rota, chamadas, tokens, ferramentas e registros no log", async () => {
  const { log } = await perguntar("Encontre a melhor opção para completar minhas CRL", { passos: [{ tool: { name: "buscar_opcoes", args: { objetivo: "meta", tipos: ["CRL"] } } }] });
  assert.equal(log.rota, "modelo+ferramenta");
  assert.equal(log.chamadas_modelo, 1);
  assert.ok(Number(log.entrada) > 0);
  const [ferr] = log.ferramentas as { nome: string; status: string; registros: number }[];
  assert.equal(ferr.nome, "buscar_opcoes");
  assert.equal(ferr.status, "OPPORTUNITIES_FOUND");
  assert.ok(ferr.registros > 0);
});

// ---------------------------------------------------------------------------
// Regressões: turnos, meio turno, roteamento.

test("meio turno do EBMSP: manhã livre não bate com tarde marcada no mesmo dia", async () => {
  const meus = [meu("e1", "2026-11-02", "DAY", "CRU", "CENTRAL", { shift: "AFTERNOON" })];
  const { r } = await perguntar("Tem plantão extra aberto pra mim?", {
    fx: { meus, extras: [oferta("EXTRA", "CRUM", "CRU", "2026-11-02", "DAY", { shift: "MORNING" }), oferta("EXTRA", "USAN", "USA", "2026-11-01", "NIGHT")] },
  });
  assert.match(r.texto, /CRUM seg 02\/11 manhã/);
  assert.match(r.texto, /USAN dom 01\/11 noite/); // meio turno não entra na vizinhança
});

test("noturno de sexta barra o diurno de sábado, mas não o noturno de sábado", async () => {
  const meus = [meu("n", "2026-10-30", "NIGHT", "USA", "PM04")];
  const { r } = await perguntar("Tem plantão extra aberto pra mim?", {
    fx: { meus, extras: [oferta("EXTRA", "SABD", "USA", "2026-10-31", "DAY"), oferta("EXTRA", "SABN", "USA", "2026-10-31", "NIGHT"), oferta("EXTRA", "SEXD", "USA", "2026-10-30", "DAY")] },
  });
  assert.match(r.texto, /SABN/);
  assert.doesNotMatch(r.texto, /SABD|SEXD/);
});

test("vaga depois do fim do rodízio não conta para a meta", async () => {
  const { r } = await perguntar("Consigo fechar minha meta?", { fx: { meta: { ...META, fim: "2026-11-03" } } });
  assert.doesNotMatch(r.texto, /CB05|CB07/);
  assert.match(r.texto, /ainda ficariam faltando 2 USA/);
});

test("plantão de hoje em andamento não é checkout pendente", () => {
  const hoje = [meu("h", HOJE, "DAY", "USA", "PR03", { status: "CHECKED_IN", checkinStatus: "VALIDATED", totpValidatedAt: "2026-10-29T10:00:00Z" })];
  const t = textoDaPresenca(hoje, HOJE, null, new Date("2026-10-29T15:00:00-03:00"));
  assert.match(t, /Nenhum checkout pendente/);
  assert.match(t, /Em andamento: \*\*PR03 qui 29\/10 dia\*\*/);
});

test("explicação: abonada conta, agendado ocupa casinha, antes do rodízio não entra", () => {
  assert.match(explicarPlantao(meu("x", "2026-10-10", "DAY", "USA", "A", { status: "EXCUSED" }), META, HOJE), /falta abonada conta/);
  assert.match(explicarPlantao(meu("y", "2026-11-10", "DAY", "USA", "A"), META, HOJE), /agendado — já ocupa a casinha/);
  assert.match(explicarPlantao(meu("z", "2026-09-20", "DAY", "USA", "A", { status: "CHECKED_OUT" }), META, HOJE), /antes do início do seu rodízio/);
});

test("roteador: inequívoco vai direto; restrição, referência ou explicação vão ao modelo", () => {
  const direto = {
    "Quanto falta pra minha meta?": "META",
    "Quanto falta para fechar minha meta?": "META",
    "Quais são meus próximos plantões?": "AGENDA",
    "tenho plantão hoje?": "AGENDA",
    "Tenho checkout pendente?": "PRESENCA",
    "Meu check-in foi confirmado?": "PRESENCA",
    "Consigo fechar minha meta?": "BUSCA",
    "Tem vaga liberada pra mim?": "BUSCA",
    "Tem plantão extra aberto pra mim?": "BUSCA",
    "Quero trocar um plantão: que trocas servem pra mim?": "BUSCA",
    "Sobrou vaga na grade?": "BUSCA",
  };
  for (const [q, tipo] of Object.entries(direto)) assert.equal(rotear(q)?.tipo, tipo, q);
  for (const q of [
    "Quero trocar minha USA de sábado",
    "Não posso segunda, o que tem?",
    "E a segunda opção?",
    "Essa bate com meu plantão?",
    "Tem uma mais perto do fim de semana?",
    "Por que meu plantão não contou na meta?",
    "Minha meta fecha mesmo com uma falta?",
    "Tem extra de noite?",
    "Encontre a melhor opção para completar minhas CRL",
    "Tem vaga de USA?",
  ]) assert.equal(rotear(q), null, q);
});
