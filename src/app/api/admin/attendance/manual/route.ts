import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { assignments, bases, checkins, faculties, qrSessions, telegramBindings, userRoles, users } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { bot } from "@/lib/telegram";
import { isWithinAdminAttendanceWindow } from "@/lib/utils";

const manualAttendanceSchema = z.object({
    assignmentId: z.string().uuid(),
    action: z.enum(["CONFIRM_PRESENT", "CONFIRM_CHECKOUT", "MARK_ABSENT"]),
});

async function requireCoordinator(req: NextRequest) {
    const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
    if (!token || token.role !== "COORDINATOR") return null;
    return token;
}

function formatShiftPeriod(period: string) {
    return period === "DAY" ? "Diurno" : "Noturno";
}

function formatDate(dateStr: string) {
    return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
}

async function notifyFacultyLeadersAbsence(params: {
    facultyId: string;
    internName: string;
    facultyAbbr: string;
    baseCode: string;
    date: string;
    period: string;
    recordedBy: string;
}) {
    if (!process.env.TELEGRAM_BOT_TOKEN) return 0;

    const leaders = await db
        .select({ chatId: telegramBindings.telegramUserId })
        .from(userRoles)
        .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.isActive, true)))
        .innerJoin(telegramBindings, eq(telegramBindings.userId, userRoles.userId))
        .where(and(
            eq(userRoles.role, "LEADER"),
            eq(userRoles.facultyId, params.facultyId),
            eq(userRoles.isActive, true),
        ));

    if (leaders.length === 0) return 0;

    const message = [
        "Falta registrada manualmente no Taximetro Digital.",
        `Interno: ${params.internName}`,
        `Faculdade: ${params.facultyAbbr}`,
        `Base: ${params.baseCode}`,
        `Turno: ${formatShiftPeriod(params.period)}`,
        `Data: ${formatDate(params.date)}`,
        `Registrado por: ${params.recordedBy}`,
    ].join("\n");

    const results = await Promise.allSettled(
        leaders.map((leader) => bot.api.sendMessage(leader.chatId, message)),
    );

    return results.filter((result) => result.status === "fulfilled").length;
}

export async function POST(req: NextRequest) {
    const token = await requireCoordinator(req);
    if (!token) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: "Corpo inválido" }, { status: 400 });
    }

    const parsed = manualAttendanceSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
    }

    const { assignmentId, action } = parsed.data;

    const [assignment] = await db
        .select({
            id: assignments.id,
            internId: assignments.internId,
            facultyId: assignments.facultyId,
            date: assignments.date,
            period: assignments.period,
            status: assignments.status,
            internName: users.name,
            baseCode: bases.code,
            facultyAbbr: faculties.abbreviation,
        })
        .from(assignments)
        .innerJoin(users, eq(users.id, assignments.internId))
        .innerJoin(bases, eq(bases.id, assignments.baseId))
        .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
        .where(eq(assignments.id, assignmentId))
        .limit(1);

    if (!assignment) {
        return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });
    }

    if (!isWithinAdminAttendanceWindow(assignment.date)) {
        return NextResponse.json(
            { success: false, error: "A ação manual só fica disponível para plantões do dia atual e do dia anterior." },
            { status: 409 },
        );
    }

    if (assignment.status === "CANCELLED") {
        return NextResponse.json({ success: false, error: "Plantão cancelado" }, { status: 409 });
    }

    const now = new Date();
    const recordedBy = String(token.name ?? "Admin");
    const [existingCheckin] = await db
        .select({
            id: checkins.id,
            status: checkins.status,
            checkinAt: checkins.checkinAt,
        })
        .from(checkins)
        .where(eq(checkins.assignmentId, assignmentId))
        .limit(1);

    if (action === "CONFIRM_PRESENT") {
        if (!["SCHEDULED", "CONFIRMED", "ABSENT"].includes(assignment.status)) {
            return NextResponse.json(
                { success: false, error: "Este plantão não pode mais ser confirmado manualmente" },
                { status: 409 },
            );
        }

        await db.transaction(async (tx) => {
            if (existingCheckin) {
                await tx.update(checkins).set({
                    checkinAt: existingCheckin.checkinAt ?? now,
                    geoValid: true,
                    status: "VALIDATED",
                    validatedBy: token.id as string,
                    totpValidatedAt: now,
                    method: "APP_DIRECT",
                }).where(eq(checkins.id, existingCheckin.id));

                await tx.update(qrSessions).set({
                    consumedAt: now,
                    consumedBy: token.id as string,
                }).where(and(eq(qrSessions.checkinId, existingCheckin.id), isNull(qrSessions.consumedAt)));
            } else {
                await tx.insert(checkins).values({
                    assignmentId,
                    internId: assignment.internId,
                    checkinAt: now,
                    geoValid: true,
                    status: "VALIDATED",
                    validatedBy: token.id as string,
                    totpValidatedAt: now,
                    method: "APP_DIRECT",
                });
            }

            await tx.update(assignments).set({
                status: "CHECKED_IN",
                updatedAt: now,
            }).where(eq(assignments.id, assignmentId));
        });

        await logAudit({
            userId: token.id as string,
            action: "MANUAL_ATTENDANCE_CONFIRMED",
            entity: "assignment",
            entityId: assignmentId,
            payload: {
                previousStatus: assignment.status,
                previousCheckinStatus: existingCheckin?.status ?? null,
                internId: assignment.internId,
                facultyId: assignment.facultyId,
            },
        });

        return NextResponse.json({
            success: true,
            data: {
                status: "CHECKED_IN",
                leaderNotificationsSent: 0,
            },
        });
    }

    if (action === "CONFIRM_CHECKOUT") {
        if (assignment.status !== "CHECKED_IN") {
            return NextResponse.json(
                { success: false, error: "Só é possível confirmar checkout de um plantão em CHECKED_IN" },
                { status: 409 },
            );
        }

        if (!existingCheckin || existingCheckin.status !== "VALIDATED") {
            return NextResponse.json(
                { success: false, error: "Checkout manual exige um check-in validado" },
                { status: 409 },
            );
        }

        await db.transaction(async (tx) => {
            await tx.update(assignments).set({
                status: "CHECKED_OUT",
                updatedAt: now,
            }).where(eq(assignments.id, assignmentId));

            await tx.update(checkins).set({
                checkoutAt: now,
                checkoutConfirmedBy: token.id as string,
                checkoutNotes: "Checkout confirmado manualmente pelo admin",
            }).where(eq(checkins.id, existingCheckin.id));

            await tx.update(qrSessions).set({
                consumedAt: now,
                consumedBy: token.id as string,
            }).where(and(eq(qrSessions.checkinId, existingCheckin.id), isNull(qrSessions.consumedAt)));
        });

        await logAudit({
            userId: token.id as string,
            action: "MANUAL_CHECKOUT_CONFIRMED",
            entity: "assignment",
            entityId: assignmentId,
            payload: {
                previousStatus: assignment.status,
                previousCheckinStatus: existingCheckin.status,
                internId: assignment.internId,
                facultyId: assignment.facultyId,
            },
        });

        return NextResponse.json({
            success: true,
            data: {
                status: "CHECKED_OUT",
                leaderNotificationsSent: 0,
            },
        });
    }

    if (!["SCHEDULED", "CONFIRMED", "ABSENT", "CHECKED_IN"].includes(assignment.status)) {
        return NextResponse.json(
            { success: false, error: "Este plantão não pode mais ser lançado como falta" },
            { status: 409 },
        );
    }

    await db.transaction(async (tx) => {
        if (existingCheckin) {
            await tx.update(checkins).set({
                status: "REJECTED",
                validatedBy: null,
                totpValidatedAt: null,
                checkoutAt: null,
                checkoutConfirmedBy: null,
                checkoutNotes: "Falta registrada manualmente pelo admin",
            }).where(eq(checkins.id, existingCheckin.id));

            await tx.update(qrSessions).set({
                consumedAt: now,
                consumedBy: token.id as string,
            }).where(and(eq(qrSessions.checkinId, existingCheckin.id), isNull(qrSessions.consumedAt)));
        }

        await tx.update(assignments).set({
            status: "ABSENT",
            updatedAt: now,
        }).where(eq(assignments.id, assignmentId));
    });

    const leaderNotificationsSent = await notifyFacultyLeadersAbsence({
        facultyId: assignment.facultyId,
        internName: assignment.internName,
        facultyAbbr: assignment.facultyAbbr,
        baseCode: assignment.baseCode,
        date: assignment.date,
        period: assignment.period,
        recordedBy,
    }).catch(() => 0);

    await logAudit({
        userId: token.id as string,
        action: "MANUAL_ABSENCE_RECORDED",
        entity: "assignment",
        entityId: assignmentId,
        payload: {
            previousStatus: assignment.status,
            previousCheckinStatus: existingCheckin?.status ?? null,
            internId: assignment.internId,
            facultyId: assignment.facultyId,
            leaderNotificationsSent,
        },
    });

    return NextResponse.json({
        success: true,
        data: {
            status: "ABSENT",
            leaderNotificationsSent,
        },
    });
}