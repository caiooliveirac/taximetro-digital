/**
 * Persistência dos sinais do interno no calendário (outro serviço, Quero,
 * Posso). A regra vive em src/shared/domain/policies/day-signal-policy.ts —
 * aqui só entra acesso a banco.
 */

import { and, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { assignments, bases, internDaySignals } from "@/shared/db/schema";
import type { SinalDoDia, SinalMarcado } from "@/shared/domain/policies/day-signal-policy";

export async function listarSinais(params: { internId: string; dateFrom: string; dateTo?: string }): Promise<SinalMarcado[]> {
  const filtros = [eq(internDaySignals.internId, params.internId), gte(internDaySignals.date, params.dateFrom)];
  if (params.dateTo) filtros.push(lte(internDaySignals.date, params.dateTo));
  return db
    .select({
      date: internDaySignals.date,
      period: internDaySignals.period,
      signal: internDaySignals.signal,
      label: internDaySignals.label,
    })
    .from(internDaySignals)
    .where(and(...filtros));
}

/** Plantões não cancelados do interno numa faixa de datas, para a regra de descanso. */
export async function plantoesDoInternoEntre(params: { internId: string; dateFrom: string; dateTo: string }) {
  return db
    .select({
      id: assignments.id,
      date: assignments.date,
      period: assignments.period,
      shift: assignments.shift,
      baseCode: bases.code,
      baseName: bases.name,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .where(
      and(
        eq(assignments.internId, params.internId),
        gte(assignments.date, params.dateFrom),
        lte(assignments.date, params.dateTo),
        ne(assignments.status, "CANCELLED"),
      ),
    );
}

export async function gravarSinal(params: {
  internId: string;
  date: string;
  period: "DAY" | "NIGHT";
  signal: SinalDoDia;
  label: string | null;
}) {
  await db
    .insert(internDaySignals)
    .values(params)
    .onConflictDoUpdate({
      target: [internDaySignals.internId, internDaySignals.date, internDaySignals.period],
      set: { signal: params.signal, label: params.label, updatedAt: new Date() },
    });
}

export async function apagarSinal(params: { internId: string; date: string; period: "DAY" | "NIGHT" }) {
  await db
    .delete(internDaySignals)
    .where(
      and(
        eq(internDaySignals.internId, params.internId),
        eq(internDaySignals.date, params.date),
        eq(internDaySignals.period, params.period),
      ),
    );
}
