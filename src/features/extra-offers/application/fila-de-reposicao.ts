/**
 * Fila da vaga livre: quem precisa de reposição vem antes de quem quer
 * plantão a mais.
 *
 * Demanda = internos ativos com casinha vazia no tipo (mesma conta das
 * casinhas da meta). Oferta = vagas liberadas e sem dono ainda abertas nos
 * próximos dias, lidas da view turnos_livres (scripts/view-turnos-livres.sql).
 * Enquanto a oferta não passar da demanda, interno de meta completa não se
 * candidata: a vaga fica para o líder escalar quem precisa.
 *
 * Só contagem, sem nome — o mesmo agregado serve a todo mundo, em cache de
 * 10 min no processo (custa ~1 s calcular a meta de todos).
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { executeGetComplianceOverview } from "@/features/compliance/application/use-cases/get-compliance-overview";
import { GOAL_KINDS, goalKindOf, type GoalKind } from "@/lib/goal-slots";

export const JANELA_DA_FILA_DIAS = 10;
const TTL_MS = 10 * 60_000;

export type FilaDoTipo = { precisam: number; casinhas: number; vagasAbertas: number };
export type Fila = Record<GoalKind, FilaDoTipo>;

/** Candidatura de quem já fechou a meta só abre quando sobra vaga depois de quem precisa. */
export function candidaturaAberta(f: FilaDoTipo | undefined): boolean {
  return Boolean(f) && f!.vagasAbertas > f!.precisam;
}

export function textoDaFila(tipo: GoalKind, f: FilaDoTipo): string {
  return `${f.precisam} colega${f.precisam === 1 ? "" : "s"} ainda precisa${f.precisam === 1 ? "" : "m"} de reposição de ${tipo} e há ${f.vagasAbertas} vaga${f.vagasAbertas === 1 ? "" : "s"} livre${f.vagasAbertas === 1 ? "" : "s"} nos próximos ${JANELA_DA_FILA_DIAS} dias`;
}

async function calcular(): Promise<Fila> {
  const fila = Object.fromEntries(GOAL_KINDS.map((k) => [k, { precisam: 0, casinhas: 0, vagasAbertas: 0 }])) as Fila;
  const [{ data }, abertas] = await Promise.all([
    executeGetComplianceOverview({ actor: { id: "", role: "COORDINATOR", facultyId: null } }),
    db.execute(sql`
      SELECT tipo, SUM(liberadas_abertas + sem_dono_abertas)::int AS n
      FROM turnos_livres
      WHERE data < current_date + ${JANELA_DA_FILA_DIAS}::int
      GROUP BY tipo
    `) as unknown as Promise<{ tipo: string; n: number }[]>,
  ]);
  for (const r of data) {
    for (const k of GOAL_KINDS) {
      const falta = r[`missing${k}`];
      if (falta > 0) {
        fila[k].precisam += 1;
        fila[k].casinhas += falta;
      }
    }
  }
  for (const a of abertas) {
    const k = goalKindOf(a.tipo);
    if (k) fila[k].vagasAbertas += Number(a.n);
  }
  return fila;
}

let cache: { em: number; valor: Promise<Fila> } | null = null;

export function filaDeReposicao(): Promise<Fila> {
  if (!cache || Date.now() - cache.em > TTL_MS) {
    const valor = calcular();
    cache = { em: Date.now(), valor };
    valor.catch(() => (cache = null));
  }
  return cache.valor;
}
