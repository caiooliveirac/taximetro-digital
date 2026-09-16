/**
 * A grade de um turno, base por base: o que o interno vê para se remanejar e
 * o que a coordenação vê no Plantão ao vivo — a mesma leitura, em dois
 * ângulos. Aqui fica a matéria-prima (capacidade, quem está lá, o estado de
 * cada base); cada tela monta as células com as suas próprias regras.
 *
 * Estado da base neste turno = eventos do `audit_log` dobrados em ordem (ver
 * plantao-ao-vivo.ts): aviso do interno, cancelamento do aviso pela
 * coordenação, base parada/reaberta pela coordenação. Mais o que o app
 * `plantoes` sabe: médico presente e desativação pelo chefe de plantão.
 */

import { and, asc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, auditLog, bases, faculties, slotRules, users } from "@/db/schema";
import { getDayOfWeek } from "@/lib/slots";
import { formatBrazilTime } from "@/lib/utils";
import { compararCodigoDeBase, type Ocupante } from "@/lib/remanejamento-interno";
import { ACAO, ACOES_DO_TURNO, estadoDoTurno, type EstadoDaBase, type EventoDoTurno } from "@/lib/plantao-ao-vivo";
import {
  canalDoPlantoesConfigurado,
  estadoDasBasesNoPlantoes,
  type Desativacao,
} from "@/features/scheduling/infra/repositories/plantoes-medicos-repository";
import { computePeriodLoad } from "@/features/scheduling/domain/policies/assignment-policy";

export type Periodo = "DAY" | "NIGHT";

/**
 * Os eventos do turno, em ordem, já dobrados no estado de cada base. A base
 * vem do payload, não do plantão: o plantão pode ter sido remanejado depois,
 * e o aviso continua sendo da base onde foi dado.
 */
export async function estadoDasBasesNoTurno(date: string, period: Periodo): Promise<Map<string, EstadoDaBase>> {
  const linhas = await db
    .select({
      action: auditLog.action,
      entityId: auditLog.entityId,
      baseId: sql<string | null>`${auditLog.payload}->>'baseId'`,
      codigo: sql<string | null>`${auditLog.payload}->>'tipo'`,
      motivo: sql<string | null>`${auditLog.payload}->>'motivo'`,
      // Aviso tem entityId = plantão; o nome de quem avisou vem daí.
      interno: users.name,
      // created_at é timestamp sem fuso preenchido por now() na sessão do banco
      // (America/Sao_Paulo no servidor); lido como Date vira UTC e atrasa 3h.
      // Formatar no SQL usa a hora como foi gravada.
      hora: sql<string>`to_char(${auditLog.createdAt}, 'HH24:MI')`,
    })
    .from(auditLog)
    .leftJoin(assignments, eq(assignments.id, auditLog.entityId))
    .leftJoin(users, eq(users.id, assignments.internId))
    .where(
      and(
        inArray(auditLog.action, [...ACOES_DO_TURNO]),
        // O índice é por created_at: o turno de hoje não tem evento de anteontem.
        gte(auditLog.createdAt, sql`(${date}::date - interval '1 day')`),
        sql`${auditLog.payload}->>'date' = ${date}`,
        sql`${auditLog.payload}->>'period' = ${period}`,
      ),
    )
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));

  const eventos: EventoDoTurno[] = [];
  for (const l of linhas) {
    if (!l.baseId) continue;
    if (l.action === ACAO.aviso) {
      eventos.push({ tipo: "AVISO", baseId: l.baseId, assignmentId: l.entityId, interno: l.interno, codigo: l.codigo, hora: l.hora });
    } else if (l.action === ACAO.avisoCancelado) {
      eventos.push({ tipo: "AVISO_CANCELADO", baseId: l.baseId, hora: l.hora });
    } else if (l.action === ACAO.baseParada) {
      eventos.push({ tipo: "PARADA", baseId: l.baseId, motivo: l.motivo, hora: l.hora });
    } else if (l.action === ACAO.baseReaberta) {
      eventos.push({ tipo: "REABERTA", baseId: l.baseId, hora: l.hora });
    }
  }
  return estadoDoTurno(eventos);
}

export type OcupanteDoTurno = Ocupante & {
  assignmentId: string;
  internId: string;
  interno: string;
  facultyName: string | null;
};

export type BaseDoTurno = {
  id: string;
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Vagas de grade neste turno: soma de slot_rules de todas as faculdades. */
  capacity: number;
  /** Limite físico do turno (0 = sem grade, sem teto). */
  limite: number;
  ocupantes: OcupanteDoTurno[];
  estado: EstadoDaBase;
  /** Desativada no `plantoes` pelo chefe de plantão, com `desde` já formatado. */
  desativada: Desativacao | null;
  medicos: string[];
};

/**
 * Todas as USAs ativas, na ordem canônica, com o que há para saber delas
 * neste turno. Consultas por conjunto, não por base.
 */
export async function basesDoTurno(date: string, period: Periodo): Promise<{ bases: BaseDoTurno[]; medicosDisponiveis: boolean }> {
  const dayOfWeek = getDayOfWeek(date);

  const [capacidade, ocupantes, usas, estado] = await Promise.all([
    db
      .select({ baseId: slotRules.baseId, capacity: sql<number>`COALESCE(SUM(${slotRules.capacity}), 0)` })
      .from(slotRules)
      .where(
        and(
          eq(slotRules.dayOfWeek, dayOfWeek),
          eq(slotRules.period, period),
          eq(slotRules.isActive, true),
          eq(slotRules.isBlocked, false),
          eq(slotRules.isExtraShift, false),
        ),
      )
      .groupBy(slotRules.baseId),
    db
      .select({
        assignmentId: assignments.id,
        internId: assignments.internId,
        interno: users.name,
        baseId: assignments.baseId,
        faculdade: faculties.abbreviation,
        facultyName: faculties.name,
        status: assignments.status,
        // O caso de uso de remanejamento anota [REMANEJADO]; quem chegou assim já conta como presente.
        remanejado: sql<boolean>`COALESCE(${assignments.notes}, '') LIKE '%[REMANEJADO]%'`,
      })
      .from(assignments)
      .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
      .innerJoin(users, eq(users.id, assignments.internId))
      .where(
        and(
          eq(assignments.date, date),
          eq(assignments.period, period),
          eq(assignments.isExtraShift, false),
          notInArray(assignments.status, ["CANCELLED", "ABSENT"]),
        ),
      )
      .orderBy(assignments.createdAt),
    db
      .select({ id: bases.id, code: bases.code, name: bases.name, latitude: bases.latitude, longitude: bases.longitude })
      .from(bases)
      .where(and(eq(bases.type, "USA"), eq(bases.isActive, true))),
    estadoDasBasesNoTurno(date, period),
  ]);
  const capacidadePorBase = new Map(capacidade.map((c) => [c.baseId, Number(c.capacity)]));
  const ocupantesPorBase = new Map<string, OcupanteDoTurno[]>();
  for (const { baseId, ...o } of ocupantes) ocupantesPorBase.set(baseId, [...(ocupantesPorBase.get(baseId) ?? []), o]);

  const plantoes = await estadoDasBasesNoPlantoes(usas.map((b) => b.code));

  const lista = usas
    .sort((a, b) => compararCodigoDeBase(a.code, b.code))
    .map((base): BaseDoTurno => {
      const capacity = capacidadePorBase.get(base.id) ?? 0;
      const ocupantes = ocupantesPorBase.get(base.id) ?? [];
      const desativada = plantoes.desativadas[base.code] ?? null;
      return {
        ...base,
        capacity,
        limite: computePeriodLoad({ capacity, occupied: ocupantes.length }).limit,
        ocupantes,
        estado: estado.get(base.id) ?? { avisos: [], parada: null },
        desativada: desativada
          ? { ...desativada, desde: desativada.desde ? formatBrazilTime(new Date(desativada.desde)) : null }
          : null,
        medicos: plantoes.medicos[base.code] ?? [],
      };
    });

  return { bases: lista, medicosDisponiveis: canalDoPlantoesConfigurado() };
}
