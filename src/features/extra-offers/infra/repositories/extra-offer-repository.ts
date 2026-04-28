import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/shared/db/client";
import {
  assignments,
  bases,
  extraShiftOffers,
  faculties,
  users,
} from "@/shared/db/schema";

/* ═══════════ Read ═══════════ */

export async function listExtraOffers(opts: { includeUnavailable?: boolean } = {}) {
  const rows = await db
    .select({
      id: extraShiftOffers.id,
      baseId: extraShiftOffers.baseId,
      baseCode: bases.code,
      baseName: bases.name,
      baseType: bases.type,
      date: extraShiftOffers.date,
      period: extraShiftOffers.period,
      shift: extraShiftOffers.shift,
      facultyId: extraShiftOffers.facultyId,
      facultyName: faculties.name,
      facultyAbbreviation: faculties.abbreviation,
      notes: extraShiftOffers.notes,
      publishedBy: extraShiftOffers.publishedBy,
      publishedByName: users.name,
      publishedAt: extraShiftOffers.publishedAt,
      claimedBy: extraShiftOffers.claimedBy,
      claimedAt: extraShiftOffers.claimedAt,
      assignmentId: extraShiftOffers.assignmentId,
      cancelledAt: extraShiftOffers.cancelledAt,
    })
    .from(extraShiftOffers)
    .innerJoin(bases, eq(bases.id, extraShiftOffers.baseId))
    .innerJoin(users, eq(users.id, extraShiftOffers.publishedBy))
    .leftJoin(faculties, eq(faculties.id, extraShiftOffers.facultyId))
    .where(opts.includeUnavailable ? undefined : and(
      isNull(extraShiftOffers.claimedBy),
      isNull(extraShiftOffers.cancelledAt),
    ))
    .orderBy(desc(extraShiftOffers.publishedAt));

  return rows;
}

export async function listExtraOffersForAdmin() {
  const claimUser = db.$with("claim_user").as(
    db.select({ id: users.id, name: users.name }).from(users),
  );

  const rows = await db
    .select({
      id: extraShiftOffers.id,
      baseId: extraShiftOffers.baseId,
      baseCode: bases.code,
      baseName: bases.name,
      baseType: bases.type,
      date: extraShiftOffers.date,
      period: extraShiftOffers.period,
      shift: extraShiftOffers.shift,
      facultyId: extraShiftOffers.facultyId,
      facultyName: faculties.name,
      facultyAbbreviation: faculties.abbreviation,
      notes: extraShiftOffers.notes,
      publishedBy: extraShiftOffers.publishedBy,
      publishedByName: users.name,
      publishedAt: extraShiftOffers.publishedAt,
      claimedBy: extraShiftOffers.claimedBy,
      claimedAt: extraShiftOffers.claimedAt,
      assignmentId: extraShiftOffers.assignmentId,
      cancelledAt: extraShiftOffers.cancelledAt,
      cancelledBy: extraShiftOffers.cancelledBy,
    })
    .from(extraShiftOffers)
    .innerJoin(bases, eq(bases.id, extraShiftOffers.baseId))
    .innerJoin(users, eq(users.id, extraShiftOffers.publishedBy))
    .leftJoin(faculties, eq(faculties.id, extraShiftOffers.facultyId))
    .orderBy(desc(extraShiftOffers.publishedAt));

  return rows;
}

export async function getExtraOfferById(id: string) {
  const [row] = await db
    .select()
    .from(extraShiftOffers)
    .where(eq(extraShiftOffers.id, id))
    .limit(1);
  return row ?? null;
}

/* ═══════════ Analytics ═══════════ */

export async function getExtraOffersAnalytics(fromDate?: string, toDate?: string) {
  const dateFilter = fromDate && toDate
    ? and(
        sql`${extraShiftOffers.date} >= ${fromDate}`,
        sql`${extraShiftOffers.date} <= ${toDate}`,
        isNull(extraShiftOffers.cancelledAt),
      )
    : isNull(extraShiftOffers.cancelledAt);

  // By faculty
  const byFaculty = await db
    .select({
      facultyId: extraShiftOffers.facultyId,
      facultyName: faculties.name,
      facultyAbbreviation: faculties.abbreviation,
      total: sql<number>`count(*)::int`,
      claimed: sql<number>`count(${extraShiftOffers.claimedBy})::int`,
    })
    .from(extraShiftOffers)
    .leftJoin(faculties, eq(faculties.id, extraShiftOffers.facultyId))
    .where(dateFilter)
    .groupBy(extraShiftOffers.facultyId, faculties.name, faculties.abbreviation)
    .orderBy(sql`count(*) desc`);

  // By claimer
  const byClaimer = await db
    .select({
      claimedBy: extraShiftOffers.claimedBy,
      claimerName: users.name,
      count: sql<number>`count(*)::int`,
    })
    .from(extraShiftOffers)
    .innerJoin(users, eq(users.id, extraShiftOffers.claimedBy))
    .where(and(
      dateFilter,
      sql`${extraShiftOffers.claimedBy} is not null`,
    ))
    .groupBy(extraShiftOffers.claimedBy, users.name)
    .orderBy(sql`count(*) desc`)
    .limit(20);

  // By base
  const byBase = await db
    .select({
      baseId: extraShiftOffers.baseId,
      baseCode: bases.code,
      baseName: bases.name,
      baseType: bases.type,
      total: sql<number>`count(*)::int`,
      claimed: sql<number>`count(${extraShiftOffers.claimedBy})::int`,
    })
    .from(extraShiftOffers)
    .innerJoin(bases, eq(bases.id, extraShiftOffers.baseId))
    .where(dateFilter)
    .groupBy(extraShiftOffers.baseId, bases.code, bases.name, bases.type)
    .orderBy(sql`count(*) desc`);

  return { byFaculty, byClaimer, byBase };
}

/* ═══════════ Write ═══════════ */

export type InsertExtraOffer = {
  baseId: string;
  date: string;
  period: "DAY" | "NIGHT";
  shift?: string | null;
  facultyId?: string | null;
  notes?: string | null;
  publishedBy: string;
};

export async function insertExtraOffer(data: InsertExtraOffer) {
  const [row] = await db
    .insert(extraShiftOffers)
    .values({
      baseId: data.baseId,
      date: data.date,
      period: data.period,
      shift: data.shift ?? null,
      facultyId: data.facultyId ?? null,
      notes: data.notes ?? null,
      publishedBy: data.publishedBy,
    })
    .returning();
  return row;
}

export async function claimExtraOffer(
  offerId: string,
  claimedBy: string,
  assignmentId: string,
) {
  // Atomic claim: only updates if still unclaimed and uncancelled
  const result = await db
    .update(extraShiftOffers)
    .set({
      claimedBy,
      claimedAt: new Date(),
      assignmentId,
    })
    .where(and(
      eq(extraShiftOffers.id, offerId),
      isNull(extraShiftOffers.claimedBy),
      isNull(extraShiftOffers.cancelledAt),
    ))
    .returning({ id: extraShiftOffers.id });

  return result.length > 0;
}

export async function cancelExtraOffer(offerId: string, cancelledBy: string) {
  const result = await db
    .update(extraShiftOffers)
    .set({
      cancelledAt: new Date(),
      cancelledBy,
    })
    .where(and(
      eq(extraShiftOffers.id, offerId),
      isNull(extraShiftOffers.claimedBy),
      isNull(extraShiftOffers.cancelledAt),
    ))
    .returning({ id: extraShiftOffers.id });

  return result.length > 0;
}
