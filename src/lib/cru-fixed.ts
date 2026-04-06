import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { assignments, bases, cruFixedAssignments, users } from "@/db/schema";

export const CRU_FIXED_NOTE = "CRU fixo semanal";
export const CRU_FIXED_REMOVED_NOTE = "CRU fixo semanal removido";

const ISO_DAY_BY_KEY: Record<string, number> = {
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
    SUN: 7,
};

type CruFixedTemplate = {
    id: string;
    internId: string;
    internName: string;
    facultyId: string;
    dayOfWeek: string;
    period: "DAY" | "NIGHT";
    validUntil: string;
};

type ExistingAssignment = {
    id: string;
    internId: string;
    facultyId: string;
    baseId: string;
    date: string;
    period: "DAY" | "NIGHT";
    status: "SCHEDULED" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "ABSENT" | "CANCELLED";
    notes: string | null;
};

export type CruFixedMaterializationResult = {
    plannedCount: number;
    createdCount: number;
    updatedCount: number;
    reactivatedCount: number;
    unchangedCount: number;
    skippedCount: number;
    skipped: Array<{
        internId: string;
        internName: string;
        date: string;
        period: "DAY" | "NIGHT";
        status: string;
    }>;
};

function normalizeDate(date: string) {
    return date.slice(0, 10);
}

function getDayOfWeekKey(date: string) {
    const normalized = normalizeDate(date);
    const day = new Date(`${normalized}T12:00:00Z`).getUTCDay();
    return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][day]!;
}

function addDays(date: string, days: number) {
    const current = new Date(`${normalizeDate(date)}T12:00:00Z`);
    current.setUTCDate(current.getUTCDate() + days);
    return current.toISOString().slice(0, 10);
}

function getMatchingDates(dayOfWeek: string, startDate: string, endDate: string) {
    const targetIsoDay = ISO_DAY_BY_KEY[dayOfWeek];
    if (!targetIsoDay) return [] as string[];

    const normalizedStart = normalizeDate(startDate);
    const normalizedEnd = normalizeDate(endDate);
    if (normalizedStart > normalizedEnd) return [];

    const start = new Date(`${normalizedStart}T12:00:00Z`);
    const startIsoDay = start.getUTCDay() === 0 ? 7 : start.getUTCDay();
    const firstDelta = (targetIsoDay - startIsoDay + 7) % 7;

    const dates: string[] = [];
    let current = addDays(normalizedStart, firstDelta);
    while (current <= normalizedEnd) {
        dates.push(current);
        current = addDays(current, 7);
    }

    return dates;
}

export async function getCruBaseId() {
    const [cruBase] = await db
        .select({ id: bases.id })
        .from(bases)
        .where(eq(bases.code, "CRU"))
        .limit(1);

    if (!cruBase) {
        throw new Error("Base CRU não encontrada");
    }

    return cruBase.id;
}

export async function getActiveCruFixedTemplates(params: {
    facultyId: string;
    startDate: string;
    templateIds?: string[];
}) {
    const conditions = [
        eq(cruFixedAssignments.facultyId, params.facultyId),
        eq(cruFixedAssignments.isActive, true),
        gte(cruFixedAssignments.validUntil, normalizeDate(params.startDate)),
    ];

    if (params.templateIds && params.templateIds.length > 0) {
        conditions.push(inArray(cruFixedAssignments.id, params.templateIds));
    }

    return db
        .select({
            id: cruFixedAssignments.id,
            internId: cruFixedAssignments.internId,
            internName: users.name,
            facultyId: cruFixedAssignments.facultyId,
            dayOfWeek: cruFixedAssignments.dayOfWeek,
            period: cruFixedAssignments.period,
            validUntil: cruFixedAssignments.validUntil,
        })
        .from(cruFixedAssignments)
        .innerJoin(users, eq(users.id, cruFixedAssignments.internId))
        .where(and(...conditions));
}

export async function materializeCruFixedAssignments(params: {
    facultyId: string;
    startDate: string;
    endDate: string;
    actorUserId: string;
    templateIds?: string[];
}): Promise<CruFixedMaterializationResult> {
    const normalizedStart = normalizeDate(params.startDate);
    const normalizedEnd = normalizeDate(params.endDate);

    if (normalizedStart > normalizedEnd) {
        return {
            plannedCount: 0,
            createdCount: 0,
            updatedCount: 0,
            reactivatedCount: 0,
            unchangedCount: 0,
            skippedCount: 0,
            skipped: [],
        };
    }

    const cruBaseId = await getCruBaseId();
    const templates = await getActiveCruFixedTemplates({
        facultyId: params.facultyId,
        startDate: normalizedStart,
        templateIds: params.templateIds,
    });

    if (templates.length === 0) {
        return {
            plannedCount: 0,
            createdCount: 0,
            updatedCount: 0,
            reactivatedCount: 0,
            unchangedCount: 0,
            skippedCount: 0,
            skipped: [],
        };
    }

    const internIds = [...new Set(templates.map((template) => template.internId))];
    const existingAssignments = await db
        .select({
            id: assignments.id,
            internId: assignments.internId,
            facultyId: assignments.facultyId,
            baseId: assignments.baseId,
            date: assignments.date,
            period: assignments.period,
            status: assignments.status,
            notes: assignments.notes,
        })
        .from(assignments)
        .where(and(
            inArray(assignments.internId, internIds),
            gte(assignments.date, normalizedStart),
            lte(assignments.date, normalizedEnd),
        ));

    const assignmentByKey = new Map<string, ExistingAssignment>();
    for (const assignment of existingAssignments) {
        assignmentByKey.set(`${assignment.internId}|${assignment.date}|${assignment.period}`, assignment);
    }

    const result: CruFixedMaterializationResult = {
        plannedCount: 0,
        createdCount: 0,
        updatedCount: 0,
        reactivatedCount: 0,
        unchangedCount: 0,
        skippedCount: 0,
        skipped: [],
    };

    for (const template of templates) {
        const lastDate = template.validUntil < normalizedEnd ? template.validUntil : normalizedEnd;
        const matchingDates = getMatchingDates(template.dayOfWeek, normalizedStart, lastDate);

        for (const date of matchingDates) {
            result.plannedCount += 1;
            const key = `${template.internId}|${date}|${template.period}`;
            const existing = assignmentByKey.get(key);

            if (!existing) {
                const [created] = await db
                    .insert(assignments)
                    .values({
                        internId: template.internId,
                        facultyId: template.facultyId,
                        baseId: cruBaseId,
                        date,
                        period: template.period,
                        createdBy: params.actorUserId,
                        notes: CRU_FIXED_NOTE,
                    })
                    .returning({
                        id: assignments.id,
                        internId: assignments.internId,
                        facultyId: assignments.facultyId,
                        baseId: assignments.baseId,
                        date: assignments.date,
                        period: assignments.period,
                        status: assignments.status,
                        notes: assignments.notes,
                    });

                assignmentByKey.set(key, created);
                result.createdCount += 1;
                continue;
            }

            const isCruAssignment = existing.baseId === cruBaseId;
            const isMutable = existing.status === "SCHEDULED" || existing.status === "CONFIRMED";

            if (existing.status === "CANCELLED") {
                const [reactivated] = await db
                    .update(assignments)
                    .set({
                        facultyId: template.facultyId,
                        baseId: cruBaseId,
                        status: "SCHEDULED",
                        notes: CRU_FIXED_NOTE,
                        updatedAt: new Date(),
                    })
                    .where(eq(assignments.id, existing.id))
                    .returning({
                        id: assignments.id,
                        internId: assignments.internId,
                        facultyId: assignments.facultyId,
                        baseId: assignments.baseId,
                        date: assignments.date,
                        period: assignments.period,
                        status: assignments.status,
                        notes: assignments.notes,
                    });

                assignmentByKey.set(key, reactivated);
                result.reactivatedCount += 1;
                continue;
            }

            if (isCruAssignment && existing.notes === CRU_FIXED_NOTE && existing.facultyId === template.facultyId) {
                result.unchangedCount += 1;
                continue;
            }

            if (isCruAssignment && isMutable) {
                const [updatedCru] = await db
                    .update(assignments)
                    .set({
                        facultyId: template.facultyId,
                        notes: CRU_FIXED_NOTE,
                        updatedAt: new Date(),
                    })
                    .where(eq(assignments.id, existing.id))
                    .returning({
                        id: assignments.id,
                        internId: assignments.internId,
                        facultyId: assignments.facultyId,
                        baseId: assignments.baseId,
                        date: assignments.date,
                        period: assignments.period,
                        status: assignments.status,
                        notes: assignments.notes,
                    });

                assignmentByKey.set(key, updatedCru);
                result.updatedCount += 1;
                continue;
            }

            if (!isCruAssignment && isMutable) {
                const [updated] = await db
                    .update(assignments)
                    .set({
                        facultyId: template.facultyId,
                        baseId: cruBaseId,
                        notes: CRU_FIXED_NOTE,
                        updatedAt: new Date(),
                    })
                    .where(eq(assignments.id, existing.id))
                    .returning({
                        id: assignments.id,
                        internId: assignments.internId,
                        facultyId: assignments.facultyId,
                        baseId: assignments.baseId,
                        date: assignments.date,
                        period: assignments.period,
                        status: assignments.status,
                        notes: assignments.notes,
                    });

                assignmentByKey.set(key, updated);
                result.updatedCount += 1;
                continue;
            }

            result.skippedCount += 1;
            if (result.skipped.length < 20) {
                result.skipped.push({
                    internId: template.internId,
                    internName: template.internName,
                    date,
                    period: template.period,
                    status: existing.status,
                });
            }
        }
    }

    return result;
}

export async function cancelCruFixedAssignments(params: {
    internId: string;
    dayOfWeek: string;
    period: "DAY" | "NIGHT";
    startDate: string;
    endDate: string;
}) {
    const normalizedStart = normalizeDate(params.startDate);
    const normalizedEnd = normalizeDate(params.endDate);
    if (normalizedStart > normalizedEnd) {
        return { cancelledCount: 0, alreadyCancelledCount: 0 };
    }

    const cruBaseId = await getCruBaseId();
    const candidates = await db
        .select({
            id: assignments.id,
            date: assignments.date,
            status: assignments.status,
            notes: assignments.notes,
        })
        .from(assignments)
        .where(and(
            eq(assignments.internId, params.internId),
            eq(assignments.baseId, cruBaseId),
            eq(assignments.period, params.period),
            gte(assignments.date, normalizedStart),
            lte(assignments.date, normalizedEnd),
        ));

    const toCancel = candidates.filter((assignment) =>
        assignment.notes === CRU_FIXED_NOTE &&
        getDayOfWeekKey(assignment.date) === params.dayOfWeek &&
        (assignment.status === "SCHEDULED" || assignment.status === "CONFIRMED"),
    );

    const alreadyCancelledCount = candidates.filter((assignment) =>
        assignment.notes === CRU_FIXED_NOTE &&
        getDayOfWeekKey(assignment.date) === params.dayOfWeek &&
        assignment.status === "CANCELLED",
    ).length;

    if (toCancel.length > 0) {
        await db
            .update(assignments)
            .set({
                status: "CANCELLED",
                notes: CRU_FIXED_REMOVED_NOTE,
                updatedAt: new Date(),
            })
            .where(inArray(assignments.id, toCancel.map((assignment) => assignment.id)));
    }

    return {
        cancelledCount: toCancel.length,
        alreadyCancelledCount,
    };
}