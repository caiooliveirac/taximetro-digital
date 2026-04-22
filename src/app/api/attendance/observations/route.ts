import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { assignments, checkins } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getEffectiveUser } from "@/lib/impersonate";

const observationSchema = z.object({
    assignmentId: z.string().uuid(),
    observations: z.string().max(2000).optional(),
});

function normalizeObservation(value?: string) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

export async function PUT(req: NextRequest) {
    const user = await getEffectiveUser(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: "Corpo inválido" }, { status: 400 });
    }

    const parsed = observationSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
    }

    const observations = normalizeObservation(parsed.data.observations);

    const [assignment] = await db
        .select({ id: assignments.id, status: assignments.status })
        .from(assignments)
        .where(and(eq(assignments.id, parsed.data.assignmentId), eq(assignments.internId, user.id)))
        .limit(1);

    if (!assignment) {
        return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });
    }

    if (assignment.status !== "CHECKED_OUT") {
        return NextResponse.json({ success: false, error: "As observações ficam disponíveis somente após o checkout." }, { status: 409 });
    }

    const [checkin] = await db
        .select({ id: checkins.id })
        .from(checkins)
        .where(eq(checkins.assignmentId, assignment.id))
        .limit(1);

    if (!checkin) {
        return NextResponse.json({ success: false, error: "Check-in não encontrado" }, { status: 404 });
    }

    await db.update(checkins).set({ internObservations: observations }).where(eq(checkins.id, checkin.id));

    await logAudit({
        userId: user.realUserId ?? user.id,
        action: "INTERN_OBSERVATIONS_UPDATED",
        entity: "checkin",
        entityId: checkin.id,
        ...((user.isImpersonating || observations) ? {
            payload: {
                ...(user.isImpersonating ? { actingAs: user.id } : {}),
                ...(observations ? { hasObservations: true } : {}),
            },
        } : {}),
    });

    return NextResponse.json({ success: true, data: { observations } });
}