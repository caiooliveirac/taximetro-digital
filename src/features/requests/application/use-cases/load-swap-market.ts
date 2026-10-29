/**
 * Fotografia do mercado de trocas: tudo que a política
 * (swap-match-policy.ts) precisa para avaliar ofertas, carregado de uma vez.
 * Usada pela tela de Trocas (get-swap-market.ts) e pelo aviso da Dai.
 */

import { addDaysToDateStr, hasShiftStarted, localDateStr } from "@/lib/utils";
import type { ContextoDoMercado, OfertaAberta, PlantaoDoMercado } from "@/shared/domain/policies/swap-match-policy";
import {
  ofertasAbertas,
  plantoesDaJanela,
  plantoesEmSolicitacao,
  preferenciasDeBase,
  sinaisDaJanela,
} from "@/features/requests/infra/repositories/swap-market-repository";

/** Até onde o mercado olha: ofertas raramente passam de dois meses à frente. */
const HORIZONTE_DIAS = 90;

export type FotografiaDoMercado = {
  hoje: string;
  ctx: ContextoDoMercado;
  /** Ofertas abertas cujo turno ainda não começou. */
  ofertas: OfertaAberta[];
  faculdadeDe: Map<string, Set<string>>;
};

export async function carregarMercado(agora: Date): Promise<FotografiaDoMercado> {
  const hoje = localDateStr(agora);
  // Um dia para trás: a noite de ontem ainda vale para o descanso de hoje.
  const de = addDaysToDateStr(hoje, -1);

  const [linhas, sinais, todasOfertas, bloqueados, preferencias] = await Promise.all([
    plantoesDaJanela({ de, ate: addDaysToDateStr(hoje, HORIZONTE_DIAS + 1) }),
    sinaisDaJanela({ de }),
    ofertasAbertas({ de: hoje }),
    plantoesEmSolicitacao(),
    preferenciasDeBase(),
  ]);

  const nomes = new Map<string, string>();
  const faculdadeDe = new Map<string, Set<string>>();
  const plantoes: PlantaoDoMercado[] = linhas.map(({ nome, ...p }) => {
    nomes.set(p.internId, nome);
    faculdadeDe.set(p.internId, (faculdadeDe.get(p.internId) ?? new Set()).add(p.facultyId));
    return p as PlantaoDoMercado;
  });

  const ofertas = todasOfertas.filter(
    (o) => !hasShiftStarted(o.plantao.date.slice(0, 10), o.plantao.period, o.plantao.shift, agora),
  );

  return {
    hoje,
    ctx: { agora, plantoes, sinais, bloqueados, cotaCruUsada: new Set(), nomes, preferencias },
    ofertas,
    faculdadeDe,
  };
}
