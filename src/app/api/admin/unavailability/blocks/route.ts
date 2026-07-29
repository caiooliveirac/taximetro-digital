/**
 * Por que cada interno está bloqueado num dia — para a tela de alocação.
 *
 * Exclusiva da Vitalmed (feature "internUnavailability"); no SAMU responde 404.
 *
 * A tela mostra todo mundo e marca quem não pode, em vez de sumir com os nomes.
 * Esconder faz quem escala procurar um interno que "sumiu" sem entender por quê;
 * mostrar com a etiqueta responde a pergunta antes de ela ser feita.
 */

import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { bloqueioDeFeature } from "@/lib/feature-gate";
import {
  bloqueiosCompostos,
  internosParaBloqueio,
} from "@/features/scheduling/infra/repositories/unavailability-repository";
import { db } from "@/shared/db/client";
import { faculties, userRoles } from "@/shared/db/schema";
import { and, eq } from "drizzle-orm";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("internUnavailability");
  if (bloqueio) return bloqueio;

  const user = await getEffectiveUser(req);
  if (!user || (user.role !== "COORDINATOR" && user.role !== "LEADER")) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? dateFrom;

  if (!ISO.test(dateFrom) || !ISO.test(dateTo)) {
    return NextResponse.json(
      { success: false, error: "dateFrom e dateTo precisam ser YYYY-MM-DD." },
      { status: 400 },
    );
  }

  // Todos os internos ativos, com a sigla da faculdade — a regra de aula fixa é
  // por faculdade, então o vínculo precisa vir junto e não pode ser suposto.
  const linhas = await db
    .select({
      internId: userRoles.userId,
      facultyAbbr: faculties.abbreviation,
    })
    .from(userRoles)
    .leftJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .where(and(eq(userRoles.role, "INTERN"), eq(userRoles.isActive, true)));

  const abbrPorInterno = new Map(linhas.map((l) => [l.internId, l.facultyAbbr]));
  const base = await internosParaBloqueio({
    internIds: [...abbrPorInterno.keys()],
    facultyAbbr: null,
  });

  const { mapa, samu } = await bloqueiosCompostos({
    internos: base.map((interno) => ({
      ...interno,
      facultyAbbr: abbrPorInterno.get(interno.id) ?? null,
    })),
    dateFrom,
    dateTo,
  });

  const blocks: Record<string, Record<string, string>> = {};
  for (const [internId, porSlot] of mapa) {
    blocks[internId] = Object.fromEntries(porSlot);
  }

  return NextResponse.json({ success: true, data: { blocks, samu } });
}
