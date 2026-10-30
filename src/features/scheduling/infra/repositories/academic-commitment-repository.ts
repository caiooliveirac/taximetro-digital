/**
 * Agenda acadêmica da turma — banco. Regra em academic-commitment-policy.ts.
 */

import { and, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/shared/db/client";
import {
  assignments,
  bases,
  cohortCommitments,
  cohorts,
  commitmentReleases,
  extraShiftOffers,
  userRoles,
  users,
} from "@/shared/db/schema";
import { hasShiftStarted } from "@/lib/utils";
import {
  chaveDoTurno,
  somaDias,
  turnosDoCompromisso,
  type Periodo,
  type TipoCompromisso,
} from "@/features/scheduling/domain/policies/academic-commitment-policy";

export type NovoCompromisso = {
  cohortId: string;
  facultyId: string;
  kind: TipoCompromisso;
  title: string;
  date: string;
  blocksDay: boolean;
  blocksNight: boolean;
  blocksEveNight: boolean;
  internIds: string[] | null;
  createdBy: string;
};

export async function getCohort(id: string) {
  const [row] = await db
    .select({
      id: cohorts.id,
      facultyId: cohorts.facultyId,
      startDate: cohorts.startDate,
      endDate: cohorts.endDate,
      name: cohorts.name,
      label: cohorts.label,
      status: cohorts.status,
    })
    .from(cohorts)
    .where(eq(cohorts.id, id))
    .limit(1);
  return row ?? null;
}

/** Turmas da faculdade que ainda não terminaram — as que podem ter agenda. */
export async function listOpenCohorts(facultyId: string, hoje: string) {
  return db
    .select({
      id: cohorts.id,
      startDate: cohorts.startDate,
      endDate: cohorts.endDate,
      name: cohorts.name,
      label: cohorts.label,
    })
    .from(cohorts)
    .where(and(eq(cohorts.facultyId, facultyId), ne(cohorts.status, "CLOSED"), gte(cohorts.endDate, hoje)))
    .orderBy(cohorts.startDate);
}

/** Outras turmas da faculdade não encerradas (semana de virada). */
export async function listOtherCohorts(facultyId: string, cohortId: string) {
  return db
    .select({ startDate: cohorts.startDate, endDate: cohorts.endDate })
    .from(cohorts)
    .where(and(eq(cohorts.facultyId, facultyId), ne(cohorts.id, cohortId), ne(cohorts.status, "CLOSED")));
}

/** Internos com vínculo ativo na turma. */
export async function listCohortInterns(cohortId: string) {
  return db
    .select({ id: users.id, name: users.name })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(
      eq(userRoles.cohortId, cohortId),
      eq(userRoles.role, "INTERN"),
      eq(userRoles.isActive, true),
      eq(userRoles.isArchived, false),
    ))
    .orderBy(users.name);
}

export async function insertCommitment(data: NovoCompromisso) {
  const [row] = await db.insert(cohortCommitments).values(data).returning({ id: cohortCommitments.id });
  return row;
}

export async function getCommitment(id: string) {
  const [row] = await db.select().from(cohortCommitments).where(eq(cohortCommitments.id, id)).limit(1);
  return row ?? null;
}

/** Compromissos vivos da faculdade com data a partir de `from`. */
export async function listCommitments(params: { facultyId: string; from: string; cohortId?: string | null }) {
  return db
    .select({
      id: cohortCommitments.id,
      cohortId: cohortCommitments.cohortId,
      kind: cohortCommitments.kind,
      title: cohortCommitments.title,
      date: cohortCommitments.date,
      blocksDay: cohortCommitments.blocksDay,
      blocksNight: cohortCommitments.blocksNight,
      blocksEveNight: cohortCommitments.blocksEveNight,
      internIds: cohortCommitments.internIds,
    })
    .from(cohortCommitments)
    .where(and(
      eq(cohortCommitments.facultyId, params.facultyId),
      // A véspera fica um dia antes da data: inclui o compromisso de amanhã.
      gte(cohortCommitments.date, params.from),
      isNull(cohortCommitments.cancelledAt),
      ...(params.cohortId ? [eq(cohortCommitments.cohortId, params.cohortId)] : []),
    ))
    .orderBy(cohortCommitments.date);
}

export async function cancelCommitment(params: { id: string; cancelledBy: string }) {
  const now = new Date();
  return db.transaction(async (tx) => {
    await tx
      .update(cohortCommitments)
      .set({ cancelledAt: now, cancelledBy: params.cancelledBy })
      .where(and(eq(cohortCommitments.id, params.id), isNull(cohortCommitments.cancelledAt)));
    // Oferta já pega fica com quem pegou.
    const canceladas = await tx
      .update(extraShiftOffers)
      .set({ cancelledAt: now, cancelledBy: params.cancelledBy })
      .where(and(
        eq(extraShiftOffers.commitmentId, params.id),
        isNull(extraShiftOffers.claimedBy),
        isNull(extraShiftOffers.cancelledAt),
      ))
      .returning({ id: extraShiftOffers.id });
    return canceladas.length;
  });
}

/**
 * Plantões dos internos no turno que ainda podem sair da escala: da grade
 * (não extra), agendados ou confirmados, turno não começado.
 */
export async function getRemovableForInterns(params: { internIds: string[]; date: string; period: Periodo }) {
  if (params.internIds.length === 0) return [];
  const rows = await db
    .select({
      id: assignments.id,
      internId: assignments.internId,
      internName: users.name,
      baseId: assignments.baseId,
      baseCode: bases.code,
      baseType: bases.type,
      shift: assignments.shift,
      isExtraShift: assignments.isExtraShift,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(users, eq(users.id, assignments.internId))
    .where(and(
      inArray(assignments.internId, params.internIds),
      eq(assignments.date, params.date),
      eq(assignments.period, params.period),
      inArray(assignments.status, ["SCHEDULED", "CONFIRMED"]),
    ))
    .orderBy(users.name);
  return rows.filter((r) => !hasShiftStarted(params.date, params.period, r.shift));
}

/**
 * Turnos bloqueados por compromisso, por interno: internId → (data|turno → título).
 * Compromisso da turma inteira vale para quem tem vínculo ativo nela.
 */
export async function academicBlocks(params: { internIds: string[]; dateFrom: string; dateTo: string }) {
  const mapa = new Map<string, Map<string, string>>();
  if (params.internIds.length === 0) return mapa;

  const vinculos = await db
    .select({ internId: userRoles.userId, cohortId: userRoles.cohortId })
    .from(userRoles)
    .where(and(
      inArray(userRoles.userId, params.internIds),
      eq(userRoles.role, "INTERN"),
      eq(userRoles.isActive, true),
    ));
  const turmasDe = new Map<string, Set<string>>();
  for (const v of vinculos) {
    if (!v.cohortId) continue;
    if (!turmasDe.has(v.internId)) turmasDe.set(v.internId, new Set());
    turmasDe.get(v.internId)!.add(v.cohortId);
  }
  const cohortIds = [...new Set(vinculos.map((v) => v.cohortId).filter((id): id is string => Boolean(id)))];
  if (cohortIds.length === 0) return mapa;

  const compromissos = await db
    .select({
      cohortId: cohortCommitments.cohortId,
      title: cohortCommitments.title,
      date: cohortCommitments.date,
      blocksDay: cohortCommitments.blocksDay,
      blocksNight: cohortCommitments.blocksNight,
      blocksEveNight: cohortCommitments.blocksEveNight,
      internIds: cohortCommitments.internIds,
    })
    .from(cohortCommitments)
    .where(and(
      inArray(cohortCommitments.cohortId, cohortIds),
      gte(cohortCommitments.date, params.dateFrom),
      // Véspera: compromisso do dia seguinte ao fim bloqueia a noite do fim.
      lte(cohortCommitments.date, somaDias(params.dateTo, 1)),
      isNull(cohortCommitments.cancelledAt),
    ));

  for (const c of compromissos) {
    const alvo = c.internIds
      ? c.internIds.filter((id) => turmasDe.get(id)?.has(c.cohortId))
      : params.internIds.filter((id) => turmasDe.get(id)?.has(c.cohortId));
    for (const t of turnosDoCompromisso(c)) {
      if (t.date < params.dateFrom || t.date > params.dateTo) continue;
      for (const internId of alvo) {
        if (!mapa.has(internId)) mapa.set(internId, new Map());
        mapa.get(internId)!.set(chaveDoTurno(t), c.title);
      }
    }
  }
  return mapa;
}

/** Título do compromisso que bloqueia o interno no turno, ou null. */
export async function academicBlockFor(internId: string, date: string, period: Periodo) {
  const mapa = await academicBlocks({ internIds: [internId], dateFrom: date, dateTo: date });
  return mapa.get(internId)?.get(chaveDoTurno({ date, period })) ?? null;
}

/** Um registro por plantão perdido; a decisão (abonar/repor) vem depois. */
export async function insertReleases(rows: Array<{
  commitmentId: string; assignmentId: string; internId: string; facultyId: string;
  date: string; period: Periodo; baseType: string;
}>) {
  if (rows.length === 0) return;
  await db.insert(commitmentReleases).values(rows).onConflictDoNothing({ target: commitmentReleases.assignmentId });
}
