import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { and, desc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { auditLog, assignments, caseRecords, checkins, cruFixedAssignments, inviteLinks, passwordResetTokens, qrSessions, requests, telegramBindings, userMergeEvents, userRoles, users } from "@/db/schema";
import { logAudit } from "@/lib/audit";

const rollbackMergeSchema = z.object({
    mergeEventId: z.string().uuid(),
});

const sourceUserSnapshotSchema = z.object({
    name: z.string(),
    cpf: z.string().nullable(),
    email: z.string().email(),
    phone: z.string().nullable(),
    passwordHash: z.string(),
    forcePasswordChange: z.boolean(),
    googleId: z.string().nullable(),
    selfie: z.string().nullable(),
    selfieUploadedAt: z.string().nullable(),
    registrationCode: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

const sourceRoleSnapshotSchema = z.object({
    id: z.string().uuid(),
    role: z.enum(["COORDINATOR", "LEADER", "PRECEPTOR", "INTERN"]),
    facultyId: z.string().uuid().nullable(),
    baseId: z.string().uuid().nullable(),
    isActive: z.boolean(),
});

const sourceBindingSnapshotSchema = z.object({
    id: z.string().uuid(),
    telegramUserId: z.string(),
    telegramName: z.string(),
    createdAt: z.string(),
});

const deletedAssignmentSnapshotSchema = z.object({
    id: z.string().uuid(),
    internId: z.string().uuid(),
    facultyId: z.string().uuid(),
    baseId: z.string().uuid(),
    date: z.string(),
    period: z.enum(["DAY", "NIGHT"]),
    status: z.enum(["SCHEDULED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "ABSENT", "CANCELLED", "EXCUSED"]),
    createdBy: z.string().uuid(),
    notes: z.string().nullable(),
    absenceJustification: z.string().nullable(),
    absenceJustificationActor: z.string().nullable(),
    absenceJustificationAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

const movedRecordsSchema = z.object({
    assignmentsInternIds: z.array(z.string().uuid()),
    assignmentsCreatedByIds: z.array(z.string().uuid()),
    checkinsInternIds: z.array(z.string().uuid()),
    checkinsValidatedByIds: z.array(z.string().uuid()),
    checkinsCheckoutConfirmedByIds: z.array(z.string().uuid()),
    requestsRequesterIds: z.array(z.string().uuid()),
    requestsTargetInternIds: z.array(z.string().uuid()),
    requestsReviewedByIds: z.array(z.string().uuid()),
    caseRecordsInternIds: z.array(z.string().uuid()),
    qrSessionsInternIds: z.array(z.string().uuid()),
    qrSessionsConsumedByIds: z.array(z.string().uuid()),
    auditLogUserIds: z.array(z.string().uuid()),
    inviteLinksCreatedByIds: z.array(z.string().uuid()),
    inviteLinksTargetUserIds: z.array(z.string().uuid()),
    passwordResetTokenIds: z.array(z.string().uuid()),
    cruFixedInternIds: z.array(z.string().uuid()),
    cruFixedCreatedByIds: z.array(z.string().uuid()),
    deletedAssignments: z.array(deletedAssignmentSnapshotSchema).optional(),
    telegramBinding: z.object({
        mode: z.enum(["none", "reassigned", "deleted"]),
        bindingId: z.string().uuid().nullable(),
    }),
});

class MergeRollbackConflictError extends Error { }

function formatAssignmentPeriod(period: "DAY" | "NIGHT") {
    return period === "DAY" ? "diurno" : "noturno";
}

async function requireCoordinator(req: NextRequest) {
    const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
    if (!token || token.role !== "COORDINATOR") return null;
    return token;
}

async function ensureUniqueAvailability(sourceUserId: string, snapshot: z.infer<typeof sourceUserSnapshotSchema>) {
    const [emailOwner] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, snapshot.email), ne(users.id, sourceUserId)))
        .limit(1);
    if (emailOwner) return "O email original do cadastro fonte já está em uso por outro usuário.";

    if (snapshot.cpf) {
        const [cpfOwner] = await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.cpf, snapshot.cpf), ne(users.id, sourceUserId)))
            .limit(1);
        if (cpfOwner) return "O CPF original do cadastro fonte já está em uso por outro usuário.";
    }

    if (snapshot.googleId) {
        const [googleOwner] = await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.googleId, snapshot.googleId), ne(users.id, sourceUserId)))
            .limit(1);
        if (googleOwner) return "A conta Google original do cadastro fonte já está vinculada a outro usuário.";
    }

    return null;
}

async function ensureRowsStillPointToTarget(params: {
    ids: string[];
    table: "assignmentsIntern" | "assignmentsCreatedBy" | "checkinsIntern" | "checkinsValidatedBy" | "checkinsCheckoutConfirmedBy" | "requestsRequester" | "requestsTargetIntern" | "requestsReviewedBy" | "caseRecordsIntern" | "qrSessionsIntern" | "qrSessionsConsumedBy" | "auditLogUser" | "inviteLinksCreatedBy" | "inviteLinksTargetUser" | "passwordResetTokensUser" | "cruFixedIntern" | "cruFixedCreatedBy" | "insertedTargetRoles" | "sourceRoles";
    targetUserId: string;
    sourceUserId: string;
}) {
    const { ids, table, targetUserId, sourceUserId } = params;
    if (ids.length === 0) return null;

    let count = 0;

    if (table === "assignmentsIntern") count = (await db.select({ id: assignments.id }).from(assignments).where(and(inArray(assignments.id, ids), eq(assignments.internId, targetUserId)))).length;
    if (table === "assignmentsCreatedBy") count = (await db.select({ id: assignments.id }).from(assignments).where(and(inArray(assignments.id, ids), eq(assignments.createdBy, targetUserId)))).length;
    if (table === "checkinsIntern") count = (await db.select({ id: checkins.id }).from(checkins).where(and(inArray(checkins.id, ids), eq(checkins.internId, targetUserId)))).length;
    if (table === "checkinsValidatedBy") count = (await db.select({ id: checkins.id }).from(checkins).where(and(inArray(checkins.id, ids), eq(checkins.validatedBy, targetUserId)))).length;
    if (table === "checkinsCheckoutConfirmedBy") count = (await db.select({ id: checkins.id }).from(checkins).where(and(inArray(checkins.id, ids), eq(checkins.checkoutConfirmedBy, targetUserId)))).length;
    if (table === "requestsRequester") count = (await db.select({ id: requests.id }).from(requests).where(and(inArray(requests.id, ids), eq(requests.requesterId, targetUserId)))).length;
    if (table === "requestsTargetIntern") count = (await db.select({ id: requests.id }).from(requests).where(and(inArray(requests.id, ids), eq(requests.targetInternId, targetUserId)))).length;
    if (table === "requestsReviewedBy") count = (await db.select({ id: requests.id }).from(requests).where(and(inArray(requests.id, ids), eq(requests.reviewedBy, targetUserId)))).length;
    if (table === "caseRecordsIntern") count = (await db.select({ id: caseRecords.id }).from(caseRecords).where(and(inArray(caseRecords.id, ids), eq(caseRecords.internId, targetUserId)))).length;
    if (table === "qrSessionsIntern") count = (await db.select({ id: qrSessions.id }).from(qrSessions).where(and(inArray(qrSessions.id, ids), eq(qrSessions.internId, targetUserId)))).length;
    if (table === "qrSessionsConsumedBy") count = (await db.select({ id: qrSessions.id }).from(qrSessions).where(and(inArray(qrSessions.id, ids), eq(qrSessions.consumedBy, targetUserId)))).length;
    if (table === "auditLogUser") count = (await db.select({ id: auditLog.id }).from(auditLog).where(and(inArray(auditLog.id, ids), eq(auditLog.userId, targetUserId)))).length;
    if (table === "inviteLinksCreatedBy") count = (await db.select({ id: inviteLinks.id }).from(inviteLinks).where(and(inArray(inviteLinks.id, ids), eq(inviteLinks.createdBy, targetUserId)))).length;
    if (table === "inviteLinksTargetUser") count = (await db.select({ id: inviteLinks.id }).from(inviteLinks).where(and(inArray(inviteLinks.id, ids), eq(inviteLinks.targetUserId, targetUserId)))).length;
    if (table === "passwordResetTokensUser") count = (await db.select({ id: passwordResetTokens.id }).from(passwordResetTokens).where(and(inArray(passwordResetTokens.id, ids), eq(passwordResetTokens.userId, targetUserId)))).length;
    if (table === "cruFixedIntern") count = (await db.select({ id: cruFixedAssignments.id }).from(cruFixedAssignments).where(and(inArray(cruFixedAssignments.id, ids), eq(cruFixedAssignments.internId, targetUserId)))).length;
    if (table === "cruFixedCreatedBy") count = (await db.select({ id: cruFixedAssignments.id }).from(cruFixedAssignments).where(and(inArray(cruFixedAssignments.id, ids), eq(cruFixedAssignments.createdBy, targetUserId)))).length;
    if (table === "insertedTargetRoles") count = (await db.select({ id: userRoles.id }).from(userRoles).where(and(inArray(userRoles.id, ids), eq(userRoles.userId, targetUserId)))).length;
    if (table === "sourceRoles") count = (await db.select({ id: userRoles.id }).from(userRoles).where(and(inArray(userRoles.id, ids), eq(userRoles.userId, sourceUserId)))).length;

    return count === ids.length ? null : "O merge já sofreu alterações posteriores e não pode ser desfeito automaticamente.";
}

export async function GET(req: NextRequest) {
    const token = await requireCoordinator(req);
    if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

    const rows = await db
        .select({
            id: userMergeEvents.id,
            sourceUserId: userMergeEvents.sourceUserId,
            sourceName: userMergeEvents.sourceName,
            sourceEmail: userMergeEvents.sourceEmail,
            targetUserId: userMergeEvents.targetUserId,
            targetName: userMergeEvents.targetName,
            targetEmail: userMergeEvents.targetEmail,
            createdAt: userMergeEvents.createdAt,
            rollbackAvailableUntil: userMergeEvents.rollbackAvailableUntil,
        })
        .from(userMergeEvents)
        .where(and(isNull(userMergeEvents.rolledBackAt), gt(userMergeEvents.rollbackAvailableUntil, new Date())))
        .orderBy(desc(userMergeEvents.createdAt));

    return NextResponse.json({
        success: true,
        data: rows,
    });
}

export async function POST(req: NextRequest) {
    const token = await requireCoordinator(req);
    if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

    try {
        const body = await req.json();
        const parsed = rollbackMergeSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

        const [event] = await db.select().from(userMergeEvents).where(eq(userMergeEvents.id, parsed.data.mergeEventId)).limit(1);
        if (!event) return NextResponse.json({ success: false, error: "Evento de merge não encontrado" }, { status: 404 });
        if (event.rolledBackAt) return NextResponse.json({ success: false, error: "Este merge já foi desfeito" }, { status: 409 });
        if (event.rollbackAvailableUntil <= new Date()) {
            return NextResponse.json({ success: false, error: "A janela automática para desfazer este merge já expirou" }, { status: 409 });
        }

        const sourceUserSnapshot = sourceUserSnapshotSchema.parse(event.sourceUserSnapshot);
        const sourceRolesSnapshot = z.array(sourceRoleSnapshotSchema).parse(event.sourceRolesSnapshot);
        const sourceBindingSnapshot = event.sourceBindingSnapshot ? sourceBindingSnapshotSchema.parse(event.sourceBindingSnapshot) : null;
        const movedRecords = movedRecordsSchema.parse(event.movedRecords);
        const deletedAssignments = movedRecords.deletedAssignments ?? [];
        const insertedTargetRoleIds = z.array(z.string().uuid()).parse(event.insertedTargetRoleIds);

        const [sourceUser, targetUser] = await Promise.all([
            db.select().from(users).where(eq(users.id, event.sourceUserId)).limit(1).then((rows) => rows[0]),
            db.select().from(users).where(eq(users.id, event.targetUserId)).limit(1).then((rows) => rows[0]),
        ]);

        if (!sourceUser || !targetUser) {
            return NextResponse.json({ success: false, error: "Os usuários envolvidos nesse merge não estão mais disponíveis" }, { status: 409 });
        }

        if (sourceUser.mergedIntoUserId !== event.targetUserId) {
            return NextResponse.json({ success: false, error: "O cadastro fonte não está mais no estado esperado para rollback" }, { status: 409 });
        }

        const uniqueConflict = await ensureUniqueAvailability(event.sourceUserId, sourceUserSnapshot);
        if (uniqueConflict) {
            return NextResponse.json({ success: false, error: uniqueConflict }, { status: 409 });
        }

        const roleStateConflict = await ensureRowsStillPointToTarget({ ids: sourceRolesSnapshot.map((role) => role.id), table: "sourceRoles", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId });
        if (roleStateConflict) return NextResponse.json({ success: false, error: roleStateConflict }, { status: 409 });

        const insertedRoleConflict = await ensureRowsStillPointToTarget({ ids: insertedTargetRoleIds, table: "insertedTargetRoles", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId });
        if (insertedRoleConflict) return NextResponse.json({ success: false, error: insertedRoleConflict }, { status: 409 });

        const trackedChecks = await Promise.all([
            ensureRowsStillPointToTarget({ ids: movedRecords.assignmentsInternIds, table: "assignmentsIntern", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.assignmentsCreatedByIds, table: "assignmentsCreatedBy", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.checkinsInternIds, table: "checkinsIntern", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.checkinsValidatedByIds, table: "checkinsValidatedBy", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.checkinsCheckoutConfirmedByIds, table: "checkinsCheckoutConfirmedBy", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.requestsRequesterIds, table: "requestsRequester", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.requestsTargetInternIds, table: "requestsTargetIntern", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.requestsReviewedByIds, table: "requestsReviewedBy", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.caseRecordsInternIds, table: "caseRecordsIntern", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.qrSessionsInternIds, table: "qrSessionsIntern", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.qrSessionsConsumedByIds, table: "qrSessionsConsumedBy", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.auditLogUserIds, table: "auditLogUser", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.inviteLinksCreatedByIds, table: "inviteLinksCreatedBy", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.inviteLinksTargetUserIds, table: "inviteLinksTargetUser", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.passwordResetTokenIds, table: "passwordResetTokensUser", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.cruFixedInternIds, table: "cruFixedIntern", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
            ensureRowsStillPointToTarget({ ids: movedRecords.cruFixedCreatedByIds, table: "cruFixedCreatedBy", targetUserId: event.targetUserId, sourceUserId: event.sourceUserId }),
        ]);
        const firstTrackedConflict = trackedChecks.find(Boolean);
        if (firstTrackedConflict) return NextResponse.json({ success: false, error: firstTrackedConflict }, { status: 409 });

        if (movedRecords.telegramBinding.mode === "deleted" && sourceBindingSnapshot) {
            const [existingTelegramBinding] = await db
                .select({ id: telegramBindings.id })
                .from(telegramBindings)
                .where(eq(telegramBindings.telegramUserId, sourceBindingSnapshot.telegramUserId))
                .limit(1);
            if (existingTelegramBinding) {
                return NextResponse.json({ success: false, error: "O vínculo de Telegram original já foi reutilizado e impede o rollback automático." }, { status: 409 });
            }
        }

        if (deletedAssignments.length > 0) {
            const existingDeletedAssignments = await db
                .select({ id: assignments.id })
                .from(assignments)
                .where(inArray(assignments.id, deletedAssignments.map((assignment) => assignment.id)));
            if (existingDeletedAssignments.length > 0) {
                return NextResponse.json({ success: false, error: "Um dos plantões descartados durante o merge já foi recriado e impede o rollback automático." }, { status: 409 });
            }
        }

        const now = new Date();
        await db.transaction(async (tx) => {
            if (movedRecords.assignmentsInternIds.length > 0) {
                await tx.update(assignments).set({ internId: event.sourceUserId, updatedAt: now }).where(inArray(assignments.id, movedRecords.assignmentsInternIds));
            }
            if (movedRecords.assignmentsCreatedByIds.length > 0) {
                await tx.update(assignments).set({ createdBy: event.sourceUserId, updatedAt: now }).where(inArray(assignments.id, movedRecords.assignmentsCreatedByIds));
            }
            if (movedRecords.checkinsInternIds.length > 0) {
                await tx.update(checkins).set({ internId: event.sourceUserId }).where(inArray(checkins.id, movedRecords.checkinsInternIds));
            }
            if (movedRecords.checkinsValidatedByIds.length > 0) {
                await tx.update(checkins).set({ validatedBy: event.sourceUserId }).where(inArray(checkins.id, movedRecords.checkinsValidatedByIds));
            }
            if (movedRecords.checkinsCheckoutConfirmedByIds.length > 0) {
                await tx.update(checkins).set({ checkoutConfirmedBy: event.sourceUserId }).where(inArray(checkins.id, movedRecords.checkinsCheckoutConfirmedByIds));
            }
            if (movedRecords.requestsRequesterIds.length > 0) {
                await tx.update(requests).set({ requesterId: event.sourceUserId }).where(inArray(requests.id, movedRecords.requestsRequesterIds));
            }
            if (movedRecords.requestsTargetInternIds.length > 0) {
                await tx.update(requests).set({ targetInternId: event.sourceUserId }).where(inArray(requests.id, movedRecords.requestsTargetInternIds));
            }
            if (movedRecords.requestsReviewedByIds.length > 0) {
                await tx.update(requests).set({ reviewedBy: event.sourceUserId }).where(inArray(requests.id, movedRecords.requestsReviewedByIds));
            }
            if (movedRecords.caseRecordsInternIds.length > 0) {
                await tx.update(caseRecords).set({ internId: event.sourceUserId }).where(inArray(caseRecords.id, movedRecords.caseRecordsInternIds));
            }
            if (movedRecords.qrSessionsInternIds.length > 0) {
                await tx.update(qrSessions).set({ internId: event.sourceUserId }).where(inArray(qrSessions.id, movedRecords.qrSessionsInternIds));
            }
            if (movedRecords.qrSessionsConsumedByIds.length > 0) {
                await tx.update(qrSessions).set({ consumedBy: event.sourceUserId }).where(inArray(qrSessions.id, movedRecords.qrSessionsConsumedByIds));
            }
            if (movedRecords.auditLogUserIds.length > 0) {
                await tx.update(auditLog).set({ userId: event.sourceUserId }).where(inArray(auditLog.id, movedRecords.auditLogUserIds));
            }
            if (movedRecords.inviteLinksCreatedByIds.length > 0) {
                await tx.update(inviteLinks).set({ createdBy: event.sourceUserId }).where(inArray(inviteLinks.id, movedRecords.inviteLinksCreatedByIds));
            }
            if (movedRecords.inviteLinksTargetUserIds.length > 0) {
                await tx.update(inviteLinks).set({ targetUserId: event.sourceUserId }).where(inArray(inviteLinks.id, movedRecords.inviteLinksTargetUserIds));
            }
            if (movedRecords.passwordResetTokenIds.length > 0) {
                await tx.update(passwordResetTokens).set({ userId: event.sourceUserId }).where(inArray(passwordResetTokens.id, movedRecords.passwordResetTokenIds));
            }
            if (movedRecords.cruFixedInternIds.length > 0) {
                await tx.update(cruFixedAssignments).set({ internId: event.sourceUserId }).where(inArray(cruFixedAssignments.id, movedRecords.cruFixedInternIds));
            }
            if (movedRecords.cruFixedCreatedByIds.length > 0) {
                await tx.update(cruFixedAssignments).set({ createdBy: event.sourceUserId }).where(inArray(cruFixedAssignments.id, movedRecords.cruFixedCreatedByIds));
            }

            for (const deletedAssignment of deletedAssignments) {
                const [slotConflict] = await tx
                    .select({ id: assignments.id })
                    .from(assignments)
                    .where(and(
                        eq(assignments.internId, deletedAssignment.internId),
                        eq(assignments.date, deletedAssignment.date),
                        eq(assignments.period, deletedAssignment.period),
                    ))
                    .limit(1);

                if (slotConflict) {
                    throw new MergeRollbackConflictError(`O rollback não pode restaurar o plantão ${deletedAssignment.date} (${formatAssignmentPeriod(deletedAssignment.period)}) porque já existe outro plantão nesse horário.`);
                }

                await tx.insert(assignments).values({
                    id: deletedAssignment.id,
                    internId: deletedAssignment.internId,
                    facultyId: deletedAssignment.facultyId,
                    baseId: deletedAssignment.baseId,
                    date: deletedAssignment.date,
                    period: deletedAssignment.period,
                    status: deletedAssignment.status,
                    createdBy: deletedAssignment.createdBy,
                    notes: deletedAssignment.notes,
                    absenceJustification: deletedAssignment.absenceJustification,
                    absenceJustificationActor: deletedAssignment.absenceJustificationActor,
                    absenceJustificationAt: deletedAssignment.absenceJustificationAt ? new Date(deletedAssignment.absenceJustificationAt) : null,
                    createdAt: new Date(deletedAssignment.createdAt),
                    updatedAt: new Date(deletedAssignment.updatedAt),
                });
            }

            if (movedRecords.telegramBinding.mode === "reassigned" && movedRecords.telegramBinding.bindingId) {
                await tx.update(telegramBindings).set({ userId: event.sourceUserId }).where(eq(telegramBindings.id, movedRecords.telegramBinding.bindingId));
            }

            if (movedRecords.telegramBinding.mode === "deleted" && sourceBindingSnapshot) {
                await tx.insert(telegramBindings).values({
                    id: sourceBindingSnapshot.id,
                    telegramUserId: sourceBindingSnapshot.telegramUserId,
                    userId: event.sourceUserId,
                    telegramName: sourceBindingSnapshot.telegramName,
                    createdAt: new Date(sourceBindingSnapshot.createdAt),
                });
            }

            if (insertedTargetRoleIds.length > 0) {
                await tx.delete(userRoles).where(inArray(userRoles.id, insertedTargetRoleIds));
            }

            for (const roleSnapshot of sourceRolesSnapshot) {
                await tx.update(userRoles).set({
                    role: roleSnapshot.role,
                    facultyId: roleSnapshot.facultyId,
                    baseId: roleSnapshot.baseId,
                    isActive: roleSnapshot.isActive,
                }).where(eq(userRoles.id, roleSnapshot.id));
            }

            await tx.update(users).set({
                name: sourceUserSnapshot.name,
                cpf: sourceUserSnapshot.cpf,
                email: sourceUserSnapshot.email,
                phone: sourceUserSnapshot.phone,
                passwordHash: sourceUserSnapshot.passwordHash,
                forcePasswordChange: sourceUserSnapshot.forcePasswordChange,
                googleId: sourceUserSnapshot.googleId,
                selfie: sourceUserSnapshot.selfie,
                selfieUploadedAt: sourceUserSnapshot.selfieUploadedAt ? new Date(sourceUserSnapshot.selfieUploadedAt) : null,
                registrationCode: sourceUserSnapshot.registrationCode,
                isActive: sourceUserSnapshot.isActive,
                mergedIntoUserId: null,
                mergedAt: null,
                mergeRollbackExpiresAt: null,
                updatedAt: now,
            }).where(eq(users.id, event.sourceUserId));

            await tx.update(userMergeEvents).set({
                rolledBackAt: now,
                rolledBackByUserId: token.id as string,
            }).where(eq(userMergeEvents.id, event.id));
        });

        await logAudit({
            userId: token.id as string,
            action: "ROLLBACK_USER_MERGE",
            entity: "user_merge_event",
            entityId: event.id,
            payload: {
                sourceUserId: event.sourceUserId,
                sourceEmail: event.sourceEmail,
                targetUserId: event.targetUserId,
                targetEmail: event.targetEmail,
            },
        });

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        if (err instanceof MergeRollbackConflictError) {
            return NextResponse.json({ success: false, error: err.message }, { status: 409 });
        }

        const message = err instanceof Error ? err.message : "Erro interno";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}