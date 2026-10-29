/**
 * Mercado de trocas do ponto de vista de um interno: as ofertas abertas que ele
 * vê, separadas pelo que resolvem para ele; o resumo das ofertas dele; a
 * janela de oferta × procura; e quantos colegas querem cada plantão dele.
 *
 * Privacidade: outro serviço de alguém nunca sai daqui. Quero/Posso de um
 * colega só aparece em dois lugares, ambos ligados a uma troca possível: na
 * oferta dele ("aceita seu plantão de X") e na oferta de quem tem o turno que
 * ele marcou (nome na lista de interessados). O resto sai em contagem.
 */

import { addDaysToDateStr, hasShiftStarted, localDateStr } from "@/lib/utils";
import {
  avaliarOferta,
  janelaDeTrocas,
  resumoDaOferta,
  visivelPara,
  type ContextoDoMercado,
  type PlantaoDoMercado,
} from "@/shared/domain/policies/swap-match-policy";
import {
  ofertasAbertas,
  plantoesDaJanela,
  plantoesEmSolicitacao,
  sinaisDaJanela,
} from "@/features/requests/infra/repositories/swap-market-repository";
import { findInternOverCruQuota } from "./handle-swap-peer-action";

/** Até onde o mercado olha: ofertas raramente passam de dois meses à frente. */
const HORIZONTE_DIAS = 90;
const DIAS_DA_JANELA = 28;

const chave = (date: string, period: string) => `${date.slice(0, 10)}|${period}`;

function plantaoResumido(p: PlantaoDoMercado) {
  return { id: p.id, date: p.date.slice(0, 10), period: p.period, shift: p.shift, baseName: p.baseName, baseType: p.baseType };
}

export async function executeGetSwapMarket(params: { internId: string; facultyId: string | null; agora?: Date }) {
  const agora = params.agora ?? new Date();
  const hoje = localDateStr(agora);
  // Um dia para trás: a noite de ontem ainda vale para o descanso de hoje.
  const de = addDaysToDateStr(hoje, -1);

  const [linhas, sinais, todasOfertas, bloqueados] = await Promise.all([
    plantoesDaJanela({ de, ate: addDaysToDateStr(hoje, HORIZONTE_DIAS + 1) }),
    sinaisDaJanela({ de }),
    ofertasAbertas({ de: hoje }),
    plantoesEmSolicitacao(),
  ]);

  const nomes = new Map<string, string>();
  const faculdadeDe = new Map<string, Set<string>>();
  const plantoes: PlantaoDoMercado[] = linhas.map(({ nome, ...p }) => {
    nomes.set(p.internId, nome);
    faculdadeDe.set(p.internId, (faculdadeDe.get(p.internId) ?? new Set()).add(p.facultyId));
    return p as PlantaoDoMercado;
  });
  const minhasFaculdades = new Set(faculdadeDe.get(params.internId) ?? []);
  if (params.facultyId) minhasFaculdades.add(params.facultyId);

  // Oferta cujo turno já começou não serve a ninguém.
  const ofertas = todasOfertas.filter(
    (o) => !hasShiftStarted(o.plantao.date.slice(0, 10), o.plantao.period, o.plantao.shift, agora),
  );
  const visiveis = ofertas.filter((o) => visivelPara(o, params.internId, minhasFaculdades));

  // Cota de CRU: só de quem pode entrar numa troca de CRU que este interno vê.
  const cotaCruUsada = new Set<string>();
  const precisamDeCota = new Set([params.internId, ...visiveis.filter((o) => o.plantao.baseType === "CENTRAL").map((o) => o.plantao.internId)]);
  for (const id of precisamDeCota) {
    if (await findInternOverCruQuota([id], hoje)) cotaCruUsada.add(id);
  }

  const ctx: ContextoDoMercado = { agora, plantoes, sinais, bloqueados, cotaCruUsada, nomes };

  const paraVoce = visiveis.map((o) => {
    const a = avaliarOferta(o, params.internId, ctx);
    return {
      requestId: o.requestId,
      ...plantaoResumido(o.plantao),
      quem: o.nome,
      quemId: o.plantao.internId,
      facultyAbbr: o.facultyAbbr,
      criadaEm: o.criadaEm,
      caixa: a.caixa,
      motivo: a.motivo,
      forca: a.forca,
      entregar: a.entregar ? plantaoResumido(a.entregar) : null,
    };
  });

  const minhasOfertas = ofertas
    .filter((o) => o.plantao.internId === params.internId)
    .map((o) => {
      const r = resumoDaOferta(o, ctx, faculdadeDe);
      return {
        requestId: o.requestId,
        podem: r.podem,
        interessados: r.interessados.map((i) => ({ internId: i.internId, nome: i.nome, sinal: i.sinal, perfeita: i.perfeita })),
      };
    });

  const procuraNosMeusPlantoes: Record<string, number> = {};
  const meus = new Set(plantoes.filter((p) => p.internId === params.internId).map((p) => chave(p.date, p.period)));
  for (const s of sinais) {
    if (s.internId === params.internId || s.signal === "OUTRO_SERVICO") continue;
    const k = chave(s.date, s.period);
    if (meus.has(k)) procuraNosMeusPlantoes[k] = (procuraNosMeusPlantoes[k] ?? 0) + 1;
  }

  return {
    paraVoce,
    minhasOfertas,
    janela: janelaDeTrocas({ de: hoje, dias: DIAS_DA_JANELA, ofertas, sinais }),
    procuraNosMeusPlantoes,
  };
}

export type MercadoDeTrocas = Awaited<ReturnType<typeof executeGetSwapMarket>>;
