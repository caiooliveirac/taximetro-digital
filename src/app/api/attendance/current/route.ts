import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, isNull, lte, gt } from "drizzle-orm";
import { db } from "@/db";
import { assignments, bases, checkins, qrSessions, users } from "@/db/schema";
import { getEffectiveUser } from "@/lib/impersonate";
import { getCurrentCode } from "@/lib/totp";
import { addDaysToDateStr, isCurrentOperationalAssignment, isWithinAttendanceWindow, isWithinShiftCheckoutWindow, localDateStr, operationalDateStr } from "@/lib/utils";

type UiState = "NONE" | "IDLE" | "AWAITING" | "VALIDATED" | "CHECKOUT_AWAITING" | "CHECKED_OUT";

type EnrichedRow = {
    id: string;
    internName: string;
    internSelfie: string | null;
    baseId: string;
    baseCode: string;
    baseName: string;
    baseLatitude: number;
    baseLongitude: number;
    date: string;
    period: string;
    shift: string | null;
    status: string;
    isExtraShift: boolean;
    notes: string | null;
    updatedAt: Date;
    checkinId: string | null;
    checkinStatus: string | null;
    checkinAt: Date | null;
    checkoutAt: Date | null;
    internObservations: string | null;
    activeSession?: {
        checkinId: string;
        totpSecret: string;
        expiresAt: Date;
        createdAt: Date;
    };
    isRecentCheckout: boolean;
};

function shiftOrder(shift: string | null): number {
    if (shift === "MORNING") return 0;
    if (shift === "AFTERNOON") return 1;
    if (shift === "NIGHT") return 2;
    return 99;
}

function localHour(date: Date): number {
    return Number(new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        hourCycle: "h23",
    }).format(date));
}

function hoursDiff(from: Date, to: Date): number {
    return Math.abs(to.getTime() - from.getTime()) / (1000 * 60 * 60);
}

function isVisibleRecentCheckout(checkoutAt: Date | null, now: Date, localToday: string): boolean {
    if (!checkoutAt) return false;
    return hoursDiff(checkoutAt, now) <= 24 && localDateStr(checkoutAt) === localToday;
}

function isCurrentAssignmentCandidate(row: EnrichedRow, today: string, localToday: string, nowHour: number): boolean {
    if (row.shift && row.period === "DAY") {
        return row.date === localToday && nowHour >= 5;
    }

    if (["SCHEDULED", "CONFIRMED", "CHECKED_IN"].includes(row.status)) {
        return isWithinAttendanceWindow(row.date, row.period as "DAY" | "NIGHT");
    }

    return isCurrentOperationalAssignment(row.date, row.period as "DAY" | "NIGHT") || row.date === today || row.date === localToday;
}

function isCheckoutWindowForRow(row: EnrichedRow): boolean {
    return isWithinShiftCheckoutWindow(row.date, row.period as "DAY" | "NIGHT", row.shift);
}

function serializeAssignment(row: EnrichedRow) {
    return {
        id: row.id,
        baseId: row.baseId,
        baseCode: row.baseCode,
        baseName: row.baseName,
        baseLatitude: row.baseLatitude,
        baseLongitude: row.baseLongitude,
        date: row.date,
        period: row.period,
        shift: row.shift,
        status: row.status,
        isExtraShift: row.isExtraShift,
        notes: row.notes,
        checkinStatus: row.checkinStatus,
    };
}

function serializeSession(row: EnrichedRow) {
    if (!row.activeSession || !row.checkinId) return null;

    return {
        checkinId: row.checkinId,
        currentCode: getCurrentCode(row.activeSession.totpSecret),
        expiresAt: row.activeSession.expiresAt.toISOString(),
    };
}

export async function GET(req: NextRequest) {
    const user = await getEffectiveUser(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });
    }

    const now = new Date();
    const nowHour = localHour(now);
    const forcedAssignmentId = req.nextUrl.searchParams.get("assignmentId");
    const today = operationalDateStr();
    const localToday = localDateStr(now);
    const pastWindow = addDaysToDateStr(localToday, -30);
    const futureWindow = addDaysToDateStr(localToday, 14);

    const rows = await db
        .select({
            id: assignments.id,
            internName: users.name,
            internSelfie: users.selfie,
            baseId: assignments.baseId,
            baseCode: bases.code,
            baseName: bases.name,
            baseLatitude: bases.latitude,
            baseLongitude: bases.longitude,
            date: assignments.date,
            period: assignments.period,
            shift: assignments.shift,
            status: assignments.status,
            isExtraShift: assignments.isExtraShift,
            notes: assignments.notes,
            updatedAt: assignments.updatedAt,
            checkinId: checkins.id,
            checkinStatus: checkins.status,
            checkinAt: checkins.checkinAt,
            checkoutAt: checkins.checkoutAt,
            internObservations: checkins.internObservations,
        })
        .from(assignments)
        .innerJoin(users, eq(users.id, assignments.internId))
        .innerJoin(bases, eq(bases.id, assignments.baseId))
        .leftJoin(checkins, eq(checkins.assignmentId, assignments.id))
        .where(
            and(
                eq(assignments.internId, user.id),
                gte(assignments.date, pastWindow),
                lte(assignments.date, futureWindow),
                inArray(assignments.status, ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]),
            ),
        )
        .orderBy(desc(assignments.date), desc(assignments.updatedAt));

    if (rows.length === 0) {
        return NextResponse.json({ success: true, data: null });
    }

    const checkinIds = rows.map((row) => row.checkinId).filter((value): value is string => Boolean(value));
    const sessionRows = checkinIds.length === 0
        ? []
        : await db
            .select({
                checkinId: qrSessions.checkinId,
                totpSecret: qrSessions.totpSecret,
                expiresAt: qrSessions.expiresAt,
                createdAt: qrSessions.createdAt,
            })
            .from(qrSessions)
            .where(
                and(
                    inArray(qrSessions.checkinId, checkinIds),
                    isNull(qrSessions.consumedAt),
                    gt(qrSessions.expiresAt, new Date()),
                ),
            )
            .orderBy(desc(qrSessions.createdAt));

    const activeSessionByCheckin = new Map<string, typeof sessionRows[number]>();
    for (const session of sessionRows) {
        if (!activeSessionByCheckin.has(session.checkinId)) {
            activeSessionByCheckin.set(session.checkinId, session);
        }
    }

    const enriched: EnrichedRow[] = rows.map((row) => {
        const activeSession = row.checkinId ? activeSessionByCheckin.get(row.checkinId) : undefined;
        const isRecentCheckout = isVisibleRecentCheckout(row.checkoutAt, now, localToday);

        return {
            ...row,
            activeSession,
            isRecentCheckout,
        };
    });

    const prioritized = [...enriched].sort((a, b) => {
        const dateSort = b.date.localeCompare(a.date);
        if (dateSort !== 0) return dateSort;

        const shiftSort = shiftOrder(a.shift) - shiftOrder(b.shift);
        if (shiftSort !== 0) return shiftSort;

        return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    const hasActionableScheduledAssignment = prioritized.some((row) =>
        ["SCHEDULED", "CONFIRMED"].includes(row.status) && (
            (row.checkinStatus === "PENDING" && Boolean(row.activeSession)) ||
            isCurrentAssignmentCandidate(row, today, localToday, nowHour)
        ),
    );

    const selected = forcedAssignmentId
        ? prioritized.find((row) => row.id === forcedAssignmentId) ?? null
        : (
            prioritized.find((row) => row.status === "CHECKED_IN" && row.activeSession && isCurrentAssignmentCandidate(row, today, localToday, nowHour)) ??
            prioritized.find((row) => row.status === "CHECKED_IN" && isCurrentAssignmentCandidate(row, today, localToday, nowHour)) ??
            prioritized.find((row) => ["SCHEDULED", "CONFIRMED"].includes(row.status) && row.checkinStatus === "PENDING" && row.activeSession) ??
            prioritized.find((row) => ["SCHEDULED", "CONFIRMED"].includes(row.status) && isCurrentAssignmentCandidate(row, today, localToday, nowHour)) ??
            (!hasActionableScheduledAssignment
                ? prioritized.find((row) => row.status === "CHECKED_OUT" && row.isRecentCheckout)
                : null) ??
            null
        );

    const latestPendingCheckout =
        prioritized.find((row) => row.status === "CHECKED_IN" && row.activeSession && isCheckoutWindowForRow(row)) ??
        prioritized.find((row) => row.status === "CHECKED_IN" && isCheckoutWindowForRow(row)) ??
        null;

    const latestCompletedCheckout = prioritized.find((row) => row.status === "CHECKED_OUT" && row.isRecentCheckout) ?? null;

    const checkoutStatus = latestPendingCheckout
        ? {
            state: latestPendingCheckout.activeSession ? "AWAITING" : "PENDING",
            assignment: serializeAssignment(latestPendingCheckout),
            checkinAt: latestPendingCheckout.checkinAt?.toISOString() ?? null,
            checkoutAt: latestPendingCheckout.checkoutAt?.toISOString() ?? null,
            internObservations: latestPendingCheckout.internObservations,
            session: serializeSession(latestPendingCheckout),
        }
        : latestCompletedCheckout
            ? {
                state: "COMPLETED",
                assignment: serializeAssignment(latestCompletedCheckout),
                checkinAt: latestCompletedCheckout.checkinAt?.toISOString() ?? null,
                checkoutAt: latestCompletedCheckout.checkoutAt?.toISOString() ?? null,
                internObservations: latestCompletedCheckout.internObservations,
                session: null,
            }
            : {
                state: "NONE",
                assignment: null,
                checkinAt: null,
                checkoutAt: null,
                internObservations: null,
                session: null,
            };

    if (!selected) {
        return NextResponse.json({ success: true, data: { current: null, checkoutStatus } });
    }

    let uiState: UiState = "IDLE";
    let session = null;

    if (selected.status === "CHECKED_IN" && selected.activeSession) {
        uiState = "CHECKOUT_AWAITING";
    } else if (selected.status === "CHECKED_IN") {
        uiState = "VALIDATED";
    } else if (selected.status === "CHECKED_OUT" && selected.isRecentCheckout) {
        uiState = "CHECKED_OUT";
    } else if (["SCHEDULED", "CONFIRMED"].includes(selected.status) && selected.checkinStatus === "PENDING" && selected.activeSession) {
        uiState = "AWAITING";
    }

    session = serializeSession(selected);

    return NextResponse.json({
        success: true,
        data: {
            current: {
                uiState,
                assignment: serializeAssignment(selected),
                intern: {
                    name: selected.internName,
                    selfie: selected.internSelfie,
                },
                checkinAt: selected.checkinAt?.toISOString() ?? null,
                checkoutAt: selected.checkoutAt?.toISOString() ?? null,
                internObservations: selected.internObservations,
                session,
                checkoutPending: uiState === "CHECKOUT_AWAITING",
                canRequestCheckout: selected.status === "CHECKED_IN" && uiState !== "CHECKOUT_AWAITING" && isCheckoutWindowForRow(selected),
            },
            checkoutStatus,
        },
    });
}