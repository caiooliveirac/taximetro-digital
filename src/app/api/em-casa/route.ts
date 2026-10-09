/**
 * GET /api/em-casa — internos que a coordenação mandou para casa (plantão
 * cancelado com [REPOR]: base desativada, sem remanejamento) e que ainda
 * precisam repor. Líder vê a própria faculdade; coordenação vê todas.
 * Janela de 14 dias: depois disso a reposição vira assunto do relatório.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, bases, faculties, users } from "@/db/schema";
import { getEffectiveUser } from "@/lib/impersonate";
import { addDaysToDateStr, localDateStr } from "@/lib/utils";
import { MARCA_REPOR, horaDaReposicao } from "@/lib/plantao-ao-vivo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const linhas = await db
    .select({
      id: assignments.id,
      internId: assignments.internId,
      interno: users.name,
      faculdade: faculties.abbreviation,
      baseCode: bases.code,
      date: assignments.date,
      period: assignments.period,
      notes: assignments.notes,
    })
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.internId))
    .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .where(
      and(
        eq(assignments.status, "CANCELLED"),
        sql`${assignments.notes} LIKE ${`%${MARCA_REPOR}%`}`,
        gte(assignments.date, addDaysToDateStr(localDateStr(), -14)),
        user.role === "LEADER" && user.facultyId ? eq(assignments.facultyId, user.facultyId) : undefined,
      ),
    )
    .orderBy(asc(assignments.date), asc(users.name));

  const data = linhas.map(({ notes, ...l }) => ({
    ...l,
    hora: horaDaReposicao(notes),
    motivo: notes?.split("\n").find((x) => x.includes(MARCA_REPOR))?.match(/parada: (.+?)\. Liberado/)?.[1] ?? null,
  }));
  return NextResponse.json({ success: true, data });
}
