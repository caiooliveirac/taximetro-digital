import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { assignments, bases, checkins } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getEffectiveUser } from "@/lib/impersonate";
import { checkCruConflict } from "@/lib/slots";

const reassignSchema = z.object({
    assignmentId: z.string().uuid(),
    newBaseId: z.string().uuid(),
    reason: z.string().trim().max(500).optional(),
    authorized: z.literal(true),
});

export async function PATCH(req: NextRequest) {
    const user = await getEffectiveUser(req);
    if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = reassignSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
    }

    const { assignmentId, newBaseId, reason } = parsed.data;

    const [assignment] = await db
        .select({
            id: assignments.id,
            internId: assignments.internId,
            facultyId: assignments.facultyId,
            baseId: assignments.baseId,
            date: assignments.date,
            period: assignments.period,
            status: assignments.status,
            notes: assignments.notes,
            currentBaseCode: bases.code,
            currentBaseName: bases.name,
            currentBaseType: bases.type,
            checkinStatus: checkins.status,
        })
        .from(assignments)
        .innerJoin(bases, eq(bases.id, assignments.baseId))
        .leftJoin(checkins, eq(checkins.assignmentId, assignments.id))
        .where(eq(assignments.id, assignmentId))
        .limit(1);

    if (!assignment) {
        return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });
    }

    if (user.role === "LEADER" && user.facultyId !== assignment.facultyId) {
        return NextResponse.json({ success: false, error: "Plantão não pertence à sua faculdade" }, { status: 403 });
    }

    if (["CHECKED_OUT", "ABSENT", "CANCELLED"].includes(assignment.status)) {
        return NextResponse.json({ success: false, error: "Este plantão não pode mais ser remanejado" }, { status: 409 });
    }

    if (assignment.baseId === newBaseId) {
        return NextResponse.json({ success: false, error: "O interno já está alocado nesta base" }, { status: 409 });
    }

    if (assignment.status === "CHECKED_IN" && !reason) {
        return NextResponse.json({ success: false, error: "Informe o motivo do remanejamento excepcional após check-in validado" }, { status: 400 });
    }

    const [targetBase] = await db
        .select({ id: bases.id, code: bases.code, name: bases.name, type: bases.type, isActive: bases.isActive })
        .from(bases)
        .where(eq(bases.id, newBaseId))
        .limit(1);

    if (!targetBase || !targetBase.isActive) {
        return NextResponse.json({ success: false, error: "Base de destino inválida" }, { status: 404 });
    }

    if (["CENTRAL", "CRL"].includes(targetBase.type)) {
        const cruConflict = await checkCruConflict(
            assignment.internId,
            assignment.date,
            assignment.period as "DAY" | "NIGHT",
            assignment.id,
        );
        if (cruConflict.conflicted) {
            return NextResponse.json({ success: false, error: cruConflict.reason ?? "Conflito com regulação" }, { status: 409 });
        }
    }

    const noteLines = assignment.notes ? [assignment.notes] : [];
    noteLines.push(`[REMANEJADO] ${assignment.currentBaseCode} -> ${targetBase.code}${reason ? ` | ${reason}` : ""}`);

    const [updated] = await db
        .update(assignments)
        .set({
            baseId: targetBase.id,
            notes: noteLines.length > 0 ? noteLines.join("\n") : null,
            updatedAt: new Date(),
        })
        .where(eq(assignments.id, assignment.id))
        .returning();

    await logAudit({
        userId: user.realUserId ?? user.id,
        action: "REASSIGN_ASSIGNMENT_BASE",
        entity: "assignment",
        entityId: assignment.id,
        payload: {
            previousBaseId: assignment.baseId,
            previousBaseCode: assignment.currentBaseCode,
            previousBaseName: assignment.currentBaseName,
            previousBaseType: assignment.currentBaseType,
            newBaseId: targetBase.id,
            newBaseCode: targetBase.code,
            newBaseName: targetBase.name,
            newBaseType: targetBase.type,
            assignmentDate: assignment.date,
            assignmentPeriod: assignment.period,
            assignmentStatus: assignment.status,
            checkinStatus: assignment.checkinStatus,
            authorized: true,
            reason: reason ?? null,
            ...(user.isImpersonating ? { impersonating: user.id, impersonateRole: user.role } : {}),
        },
    });

    return NextResponse.json({ success: true, data: updated });
}