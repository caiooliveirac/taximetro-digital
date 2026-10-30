/**
 * Liberações da agenda acadêmica — banco. Ver commitment_releases no schema.
 */

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { bases, assignments, cohortCommitments, commitmentReleases, faculties, users } from "@/shared/db/schema";

export type Resolucao = "PENDENTE" | "ABONADO" | "REPOR";

/** Liberações com interno, base e compromisso; sem faculdade = todas. */
export async function listReleases(params: { facultyId?: string | null; from: string }) {
  return db
    .select({
      id: commitmentReleases.id,
      internId: commitmentReleases.internId,
      internName: users.name,
      facultyId: commitmentReleases.facultyId,
      facultyAbbr: faculties.abbreviation,
      date: commitmentReleases.date,
      period: commitmentReleases.period,
      baseType: commitmentReleases.baseType,
      baseCode: bases.code,
      resolution: commitmentReleases.resolution,
      resolvedAt: commitmentReleases.resolvedAt,
      title: cohortCommitments.title,
      kind: cohortCommitments.kind,
    })
    .from(commitmentReleases)
    .innerJoin(users, eq(users.id, commitmentReleases.internId))
    .innerJoin(faculties, eq(faculties.id, commitmentReleases.facultyId))
    .innerJoin(assignments, eq(assignments.id, commitmentReleases.assignmentId))
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(cohortCommitments, eq(cohortCommitments.id, commitmentReleases.commitmentId))
    .where(and(
      gte(commitmentReleases.date, params.from),
      ...(params.facultyId ? [eq(commitmentReleases.facultyId, params.facultyId)] : []),
    ))
    .orderBy(desc(commitmentReleases.date), users.name);
}

export async function getRelease(id: string) {
  const [row] = await db.select().from(commitmentReleases).where(eq(commitmentReleases.id, id)).limit(1);
  return row ?? null;
}

export async function setResolution(params: { id: string; resolution: Resolucao; resolvedBy: string }) {
  await db
    .update(commitmentReleases)
    .set({ resolution: params.resolution, resolvedBy: params.resolvedBy, resolvedAt: new Date() })
    .where(eq(commitmentReleases.id, params.id));
}

/** Liberações marcadas para repor, dos internos dados (ou de todos). */
export async function listToReplace(params: { internIds?: string[]; from: string }) {
  return db
    .select({
      internId: commitmentReleases.internId,
      date: commitmentReleases.date,
      period: commitmentReleases.period,
      baseType: commitmentReleases.baseType,
      baseCode: bases.code,
      title: cohortCommitments.title,
    })
    .from(commitmentReleases)
    .innerJoin(assignments, eq(assignments.id, commitmentReleases.assignmentId))
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(cohortCommitments, eq(cohortCommitments.id, commitmentReleases.commitmentId))
    .where(and(
      eq(commitmentReleases.resolution, "REPOR"),
      gte(commitmentReleases.date, params.from),
      ...(params.internIds ? [inArray(commitmentReleases.internId, params.internIds)] : []),
    ));
}
