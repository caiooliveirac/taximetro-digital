/**
 * Vaga oferecida tem que caber na viatura. De dia BR60, BR05, PM04 e PM40
 * levam um interno; à noite só as bases de NOITE_DUPLA levam dois (teto em
 * auto-release-policy.ts). Uma vaga livre aberta numa base que já está no
 * teto naquele turno não é vaga: alguém foi escalado por outro caminho.
 *
 * Só USA tem teto físico; CRU e CRL seguem a grade.
 */

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, bases } from "@/db/schema";
import { capacidadeDaBase, type Periodo } from "@/features/scheduling/domain/policies/auto-release-policy";
import type { GoalKind } from "@/lib/goal-slots";

type Turno = { baseCode: string; tipo: GoalKind | null; date: string; period: Periodo };

const chave = (t: { baseCode: string; date: string; period: string }) => `${t.baseCode}|${t.date}|${t.period}`;

/** Cabe mais um interno nesse turno da base? Pura, para teste. */
export function cabeNaBase(t: Turno, ocupadas: number): boolean {
  if (t.tipo !== "USA") return true;
  const teto = capacidadeDaBase(t.baseCode, t.period);
  return teto === null || ocupadas < teto;
}

/** Só as vagas cuja base ainda tem lugar no turno, contando os plantões ativos de todas as faculdades. */
export async function soAsQueCabem<T extends Turno>(vagas: T[]): Promise<T[]> {
  const usa = vagas.filter((v) => v.tipo === "USA");
  if (!usa.length) return vagas;
  const rows = await db
    .select({ baseCode: bases.code, date: sql<string>`${assignments.date}::text`, period: assignments.period, n: sql<number>`count(*)::int` })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .where(and(
      inArray(bases.code, [...new Set(usa.map((v) => v.baseCode))]),
      inArray(assignments.date, [...new Set(usa.map((v) => v.date))]),
      notInArray(assignments.status, ["CANCELLED", "ABSENT"]),
    ))
    .groupBy(bases.code, assignments.date, assignments.period);
  const ocupadas = new Map(rows.map((r) => [chave(r), Number(r.n)]));
  return vagas.filter((v) => cabeNaBase(v, ocupadas.get(chave(v)) ?? 0));
}
