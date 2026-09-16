/**
 * GET /api/intern/reposicao — o plantão de hoje que a coordenação liberou
 * para repor em outro dia (Plantão ao vivo), se houver.
 *
 * Existe porque a lista de plantões do interno esconde cancelados de
 * propósito (registro administrativo), e este cancelado é o único que o
 * interno precisa ver na hora: a base parou, não é falta, e ele tem que
 * escolher outro dia. Só o turno operacional em andamento; passado o turno,
 * a casinha vazia da meta já conta a história.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, bases } from "@/db/schema";
import { getEffectiveUser } from "@/lib/impersonate";
import { operationalDateStr, operationalPeriod } from "@/lib/utils";
import { MARCA_REPOR } from "@/lib/plantao-ao-vivo";

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "INTERN") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const linhas = await db
    .select({ id: assignments.id, baseCode: bases.code, baseName: bases.name, notes: assignments.notes })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .where(
      and(
        eq(assignments.internId, user.id),
        eq(assignments.date, operationalDateStr()),
        eq(assignments.period, operationalPeriod()),
        eq(assignments.status, "CANCELLED"),
        sql`${assignments.notes} LIKE ${`%${MARCA_REPOR}%`}`,
      ),
    );
  const data = linhas.map(({ notes, ...l }) => ({
    ...l,
    texto: notes?.split("\n").find((linha) => linha.includes(MARCA_REPOR))?.replace(MARCA_REPOR, "").trim() ?? "",
  }));
  return NextResponse.json({ success: true, data });
}
