import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cruFixedAssignments } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getEffectiveUser } from "@/lib/impersonate";
import { logAudit } from "@/lib/audit";
import { materializeCruFixedAssignments } from "@/lib/cru-fixed";
import { addDaysToDateStr, localDateStr } from "@/lib/utils";
import { z } from "zod/v4";

/**
 * POST — Materialize CRU fixed assignments for a given week.
 * Creates real assignments from active templates.
 */
export async function POST(req: NextRequest) {
    const user = await getEffectiveUser(req);
    if (!user || !["LEADER", "COORDINATOR"].includes(user.role) || !user.facultyId) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = z.object({
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: "Data inválida" }, { status: 400 });
    }

    const { weekStart } = parsed.data;

    // Get active templates for leader's faculty
    const templates = await db
        .select({
            internId: cruFixedAssignments.internId,
            dayOfWeek: cruFixedAssignments.dayOfWeek,
            period: cruFixedAssignments.period,
            facultyId: cruFixedAssignments.facultyId,
        })
        .from(cruFixedAssignments)
        .where(and(
            eq(cruFixedAssignments.facultyId, user.facultyId),
            eq(cruFixedAssignments.isActive, true),
            sql`${cruFixedAssignments.validUntil} >= ${weekStart}`,
        ));

    if (templates.length === 0) {
        return NextResponse.json({ success: true, created: 0, message: "Nenhum fixo CRU cadastrado" });
    }

    const weekEnd = addDaysToDateStr(weekStart, 6);
    const sync = await materializeCruFixedAssignments({
        facultyId: user.facultyId,
        startDate: weekStart > localDateStr() ? weekStart : localDateStr(),
        endDate: weekEnd,
        actorUserId: user.realUserId ?? user.id,
    });

    await logAudit({
        userId: user.realUserId ?? user.id,
        action: "CRU_FIXED_GENERATE",
        entity: "cru_fixed_assignments",
        payload: { weekStart, templatesCount: templates.length, ...sync },
    });

    return NextResponse.json({
        success: true,
        created: sync.createdCount,
        updated: sync.updatedCount,
        reactivated: sync.reactivatedCount,
        unchanged: sync.unchangedCount,
        skipped: sync.skippedCount,
        total: sync.plannedCount,
        data: sync,
    });
}
