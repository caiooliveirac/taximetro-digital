/**
 * Persistência das indisponibilidades declaradas pelo interno.
 *
 * A regra de teto vive em src/shared/domain/policies/unavailability-policy.ts —
 * aqui só entra acesso a banco.
 */

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { internUnavailability, userRoles, users } from "@/shared/db/schema";
import type { Indisponibilidade } from "@/shared/domain/policies/unavailability-policy";

export type ItemPersistido = Indisponibilidade & {
  id: string;
  internId: string;
  notes: string | null;
};

/** Indisponibilidades de um interno numa faixa de datas (a semana, na prática). */
export async function listarPorInterno(params: {
  internId: string;
  dateFrom: string;
  dateTo: string;
}): Promise<ItemPersistido[]> {
  const linhas = await db
    .select({
      id: internUnavailability.id,
      internId: internUnavailability.internId,
      date: internUnavailability.date,
      period: internUnavailability.period,
      reason: internUnavailability.reason,
      notes: internUnavailability.notes,
    })
    .from(internUnavailability)
    .where(
      and(
        eq(internUnavailability.internId, params.internId),
        gte(internUnavailability.date, params.dateFrom),
        lte(internUnavailability.date, params.dateTo),
      ),
    );

  return linhas as ItemPersistido[];
}

/**
 * Mapa que o sorteio consome: internId → Set("date|period").
 *
 * Formato igual ao de `cruBlocked` de propósito — o alocador já sabe lidar com
 * ele, então a indisponibilidade entra como mais um bloqueio, sem caminho novo.
 */
export async function mapaDeBloqueioPorInterno(params: {
  internIds: string[];
  dateFrom: string;
  dateTo: string;
}): Promise<Map<string, Set<string>>> {
  const mapa = new Map<string, Set<string>>();
  if (params.internIds.length === 0) return mapa;

  const linhas = await db
    .select({
      internId: internUnavailability.internId,
      date: internUnavailability.date,
      period: internUnavailability.period,
    })
    .from(internUnavailability)
    .where(
      and(
        inArray(internUnavailability.internId, params.internIds),
        gte(internUnavailability.date, params.dateFrom),
        lte(internUnavailability.date, params.dateTo),
      ),
    );

  for (const linha of linhas) {
    if (!mapa.has(linha.internId)) mapa.set(linha.internId, new Set());
    mapa.get(linha.internId)!.add(`${linha.date}|${linha.period}`);
  }
  return mapa;
}

/**
 * Substitui a semana inteira do interno.
 *
 * Substituição, e não merge, porque a validação de teto é sobre o conjunto: se
 * a gravação fosse item a item, duas chamadas concorrentes poderiam passar cada
 * uma na sua validação e estourar o teto juntas. Apagar e reinserir dentro de
 * uma transação faz o estado final ser sempre um conjunto já validado.
 */
export async function substituirSemana(params: {
  internId: string;
  datasDaSemana: string[];
  itens: Indisponibilidade[];
  createdBy: string;
  notesPorSlot?: Map<string, string | null>;
}): Promise<void> {
  const primeira = params.datasDaSemana[0];
  const ultima = params.datasDaSemana[params.datasDaSemana.length - 1];

  await db.transaction(async (tx) => {
    await tx
      .delete(internUnavailability)
      .where(
        and(
          eq(internUnavailability.internId, params.internId),
          gte(internUnavailability.date, primeira),
          lte(internUnavailability.date, ultima),
        ),
      );

    if (params.itens.length === 0) return;

    await tx.insert(internUnavailability).values(
      params.itens.map((item) => ({
        internId: params.internId,
        date: item.date,
        period: item.period,
        reason: item.reason,
        notes: params.notesPorSlot?.get(`${item.date}|${item.period}`) ?? null,
        createdBy: params.createdBy,
      })),
    );
  });
}

/** Para a tela do admin: indisponibilidades da semana com o nome do interno. */
export async function listarDaSemanaPorFaculdade(params: {
  facultyId: string;
  dateFrom: string;
  dateTo: string;
}): Promise<Array<ItemPersistido & { internName: string }>> {
  const linhas = await db
    .select({
      id: internUnavailability.id,
      internId: internUnavailability.internId,
      date: internUnavailability.date,
      period: internUnavailability.period,
      reason: internUnavailability.reason,
      notes: internUnavailability.notes,
      internName: users.name,
    })
    .from(internUnavailability)
    .innerJoin(users, eq(users.id, internUnavailability.internId))
    // A faculdade do interno vive em user_roles, não em users — um usuário pode
    // ter mais de um papel, e é o papel INTERN que carrega o vínculo.
    .innerJoin(userRoles, eq(userRoles.userId, internUnavailability.internId))
    .where(
      and(
        eq(userRoles.facultyId, params.facultyId),
        eq(userRoles.role, "INTERN"),
        eq(userRoles.isActive, true),
        gte(internUnavailability.date, params.dateFrom),
        lte(internUnavailability.date, params.dateTo),
      ),
    );

  return linhas as Array<ItemPersistido & { internName: string }>;
}
