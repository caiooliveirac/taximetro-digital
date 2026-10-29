/**
 * Leitura do mercado de trocas: plantões da janela, sinais, ofertas abertas e
 * plantões já envolvidos em solicitação. A regra vive em
 * src/shared/domain/policies/swap-match-policy.ts — aqui só entra banco.
 */

import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/shared/db/client";
import { assignments, bases, faculties, internDaySignals, requests, users } from "@/shared/db/schema";
import type { OfertaAberta, PlantaoDoMercado, SinalDoMercado } from "@/shared/domain/policies/swap-match-policy";

const camposDoPlantao = {
  id: assignments.id,
  internId: assignments.internId,
  facultyId: assignments.facultyId,
  date: assignments.date,
  period: assignments.period,
  shift: assignments.shift,
  baseCode: bases.code,
  baseName: bases.name,
  baseType: bases.type,
  status: assignments.status,
  isExtraShift: assignments.isExtraShift,
};

/** Plantões não cancelados de todos os internos numa faixa de datas, com o nome de cada um. */
export async function plantoesDaJanela(params: { de: string; ate: string }) {
  return db
    .select({ ...camposDoPlantao, nome: users.name })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(users, eq(users.id, assignments.internId))
    .where(and(gte(assignments.date, params.de), lte(assignments.date, params.ate), ne(assignments.status, "CANCELLED")));
}

export async function sinaisDaJanela(params: { de: string }): Promise<SinalDoMercado[]> {
  return db
    .select({
      internId: internDaySignals.internId,
      date: internDaySignals.date,
      period: internDaySignals.period,
      signal: internDaySignals.signal,
      label: internDaySignals.label,
    })
    .from(internDaySignals)
    .where(gte(internDaySignals.date, params.de));
}

/** Ofertas de troca ainda sem proposta (OPEN), de plantões a partir de `de`. */
export async function ofertasAbertas(params: { de: string }): Promise<OfertaAberta[]> {
  const solicitante = alias(users, "solicitante");
  const linhas = await db
    .select({
      requestId: requests.id,
      criadaEm: requests.createdAt,
      nome: solicitante.name,
      facultyAbbr: faculties.abbreviation,
      ...camposDoPlantao,
    })
    .from(requests)
    .innerJoin(assignments, eq(assignments.id, requests.assignmentId))
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(solicitante, eq(solicitante.id, requests.requesterId))
    .leftJoin(faculties, eq(faculties.id, assignments.facultyId))
    .where(and(eq(requests.type, "SWAP"), eq(requests.status, "OPEN"), gte(assignments.date, params.de)));

  return linhas.map(({ requestId, criadaEm, nome, facultyAbbr, ...plantao }) => ({
    requestId,
    criadaEm: criadaEm.toISOString(),
    nome: nome ?? "Colega",
    facultyAbbr,
    plantao: plantao as PlantaoDoMercado,
  }));
}

/** Plantões que já estão numa solicitação aberta ou pendente (de qualquer lado). */
export async function plantoesEmSolicitacao(): Promise<Set<string>> {
  const linhas = await db
    .select({ a: requests.assignmentId, b: requests.targetAssignmentId })
    .from(requests)
    .where(inArray(requests.status, ["OPEN", "PENDING"]));
  const ids = new Set<string>();
  for (const l of linhas) {
    if (l.a) ids.add(l.a);
    if (l.b) ids.add(l.b);
  }
  return ids;
}
