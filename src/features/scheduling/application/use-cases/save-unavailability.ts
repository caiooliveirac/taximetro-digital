/**
 * Salvar a semana de indisponibilidade de um interno.
 *
 * Quem pode: o próprio interno, ou um COORDINATOR corrigindo por ele (decisão
 * do produto — o interno declara, a gestão conserta quando precisa).
 */

import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  validarSemana,
  datasDaSemana,
  inicioDaSemana,
  MOTIVOS_INDISPONIBILIDADE,
  type Indisponibilidade,
} from "@/shared/domain/policies/unavailability-policy";
import {
  listarPorInterno,
  substituirSemana,
} from "@/features/scheduling/infra/repositories/unavailability-repository";

export const saveUnavailabilitySchema = z.object({
  /** Qualquer data dentro da semana — o servidor normaliza para a segunda. */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Interno alvo. Só o COORDINATOR pode mandar um id diferente do seu. */
  internId: z.string().uuid().optional(),
  itens: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        period: z.enum(["DAY", "NIGHT"]),
        reason: z.enum(MOTIVOS_INDISPONIBILIDADE),
        notes: z.string().max(280).nullish(),
      }),
    )
    // O teto real (4) é da política; aqui só evitamos processar payload absurdo.
    .max(50),
});

export type SaveUnavailabilityActor = {
  id: string;
  role: string;
  isImpersonating: boolean;
  realUserId: string | null;
};

export async function executeSaveUnavailability(params: {
  actor: SaveUnavailabilityActor;
  input: z.infer<typeof saveUnavailabilitySchema>;
}) {
  const { actor, input } = params;

  const alvo = input.internId ?? actor.id;
  const ehOProprio = alvo === actor.id;
  const ehCoordenador = actor.role === "COORDINATOR";

  if (!ehOProprio && !ehCoordenador) {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }
  if (ehOProprio && actor.role !== "INTERN" && !ehCoordenador) {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }

  const semana = datasDaSemana(input.weekStart);
  const primeira = semana[0];
  const ultima = semana[6];

  // Toda data enviada precisa cair na semana declarada — sem isso, dava para
  // furar o teto espalhando itens por semanas diferentes numa chamada só.
  for (const item of input.itens) {
    if (item.date < primeira || item.date > ultima) {
      return {
        status: 400,
        body: {
          success: false,
          error: `A data ${item.date} não pertence à semana de ${primeira}.`,
        },
      } as const;
    }
  }

  const itens: Indisponibilidade[] = input.itens.map((item) => ({
    date: item.date,
    period: item.period,
    reason: item.reason,
  }));

  const validacao = validarSemana(itens);
  if (!validacao.ok) {
    return { status: 400, body: { success: false, error: validacao.motivo } } as const;
  }

  const notesPorSlot = new Map<string, string | null>(
    input.itens.map((item) => [`${item.date}|${item.period}`, item.notes ?? null]),
  );

  await substituirSemana({
    internId: alvo,
    datasDaSemana: semana,
    itens,
    createdBy: actor.realUserId ?? actor.id,
    notesPorSlot,
  });

  await logAudit({
    userId: actor.realUserId ?? actor.id,
    action: "UPDATE",
    entity: "intern_unavailability",
    entityId: alvo,
    payload: {
      weekStart: inicioDaSemana(input.weekStart),
      total: itens.length,
      porMotivo: Object.fromEntries(
        MOTIVOS_INDISPONIBILIDADE.map((motivo) => [
          motivo,
          itens.filter((item) => item.reason === motivo).length,
        ]),
      ),
      ...(ehOProprio ? {} : { corrigidoPorAdmin: true }),
      ...(actor.isImpersonating ? { impersonating: actor.id } : {}),
    },
  });

  const salvos = await listarPorInterno({
    internId: alvo,
    dateFrom: primeira,
    dateTo: ultima,
  });

  return {
    status: 200,
    body: { success: true, data: { weekStart: primeira, itens: salvos } },
  } as const;
}
