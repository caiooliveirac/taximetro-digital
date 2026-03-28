import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { assignments } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getEffectiveUser } from "@/lib/impersonate";

const absenceJustificationSchema = z.object({
    justification: z.string().trim().min(5).max(2000),
});

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const user = await getEffectiveUser(req);
    if (!user || !["COORDINATOR", "LEADER", "INTERN"].includes(user.role)) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = absenceJustificationSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: "Justificativa inválida" }, { status: 400 });
    }

    const { id } = await params;
    const [assignment] = await db
        .select({
            id: assignments.id,
            internId: assignments.internId,
            facultyId: assignments.facultyId,
            status: assignments.status,
            date: assignments.date,
            period: assignments.period,
        })
        .from(assignments)
        .where(eq(assignments.id, id))
        .limit(1);

    if (!assignment) {
        return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });
    }

    if (assignment.status !== "ABSENT") {
        return NextResponse.json({ success: false, error: "Só é possível justificar plantões marcados como falta" }, { status: 409 });
    }

    if (user.role === "INTERN" && assignment.internId !== user.id) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    if (user.role === "LEADER" && assignment.facultyId !== user.facultyId) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    const now = new Date();
    const actor = user.role === "INTERN"
        ? "INTERN"
        : user.role === "LEADER"
            ? "LEADER"
            : "COORDINATOR";

    const [updated] = await db
        .update(assignments)
        .set({
            absenceJustification: parsed.data.justification,
            absenceJustificationActor: actor,
            absenceJustificationAt: now,
            updatedAt: now,
        })
        .where(and(eq(assignments.id, assignment.id), eq(assignments.status, "ABSENT")))
        .returning({
            id: assignments.id,
            absenceJustification: assignments.absenceJustification,
            absenceJustificationActor: assignments.absenceJustificationActor,
            absenceJustificationAt: assignments.absenceJustificationAt,
        });

    if (!updated) {
        return NextResponse.json({ success: false, error: "O plantão mudou de status antes da gravação. Atualize a página." }, { status: 409 });
    }

    await logAudit({
        userId: user.realUserId ?? user.id,
        action: "SAVE_ABSENCE_JUSTIFICATION",
        entity: "assignment",
        entityId: assignment.id,
        payload: {
            assignmentDate: assignment.date,
            assignmentPeriod: assignment.period,
            internId: assignment.internId,
            facultyId: assignment.facultyId,
            actor,
            justificationLength: parsed.data.justification.length,
            ...(user.isImpersonating ? { impersonating: user.id, impersonateRole: user.role } : {}),
        },
    });

    return NextResponse.json({ success: true, data: updated });
}