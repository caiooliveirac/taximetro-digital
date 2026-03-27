import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cruFixedAssignments, assignments, bases } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getEffectiveUser } from "@/lib/impersonate";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";

const DOW_MAP: Record<string, number> = {
    SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

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

    // Get CRU base
    const [cruBase] = await db
        .select({ id: bases.id })
        .from(bases)
        .where(eq(bases.type, "CENTRAL"))
        .limit(1);
    if (!cruBase) {
        return NextResponse.json({ success: false, error: "Base CRU não encontrada" }, { status: 404 });
    }

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

    // Map weekStart date to compute each day of the week
    const ws = new Date(weekStart + "T12:00:00Z");
    const wsDow = ws.getUTCDay(); // 0=Sun ... 6=Sat

    const toInsert: Array<{
        internId: string;
        facultyId: string;
        baseId: string;
        date: string;
        period: "DAY" | "NIGHT";
        createdBy: string;
        notes: string;
    }> = [];

    for (const t of templates) {
        const targetDow = DOW_MAP[t.dayOfWeek];
        if (targetDow === undefined) continue;
        let diff = targetDow - wsDow;
        if (diff < 0) diff += 7;
        const d = new Date(ws);
        d.setUTCDate(d.getUTCDate() + diff);
        const dateStr = d.toISOString().slice(0, 10);

        toInsert.push({
            internId: t.internId,
            facultyId: t.facultyId,
            baseId: cruBase.id,
            date: dateStr,
            period: t.period as "DAY" | "NIGHT",
            createdBy: user.realUserId ?? user.id,
            notes: "CRU fixo semanal",
        });
    }

    // Insert assignments, skip duplicates (intern already has assignment that day/period)
    let created = 0;
    for (const row of toInsert) {
        try {
            const inserted = await db
                .insert(assignments)
                .values(row)
                .onConflictDoNothing()
                .returning({ id: assignments.id });
            if (inserted.length > 0) created++;
        } catch {
            // skip errors (e.g. capacity constraints handled elsewhere)
        }
    }

    await logAudit({
        userId: user.realUserId ?? user.id,
        action: "CRU_FIXED_GENERATE",
        entity: "cru_fixed_assignments",
        payload: { weekStart, templatesCount: templates.length, createdCount: created },
    });

    return NextResponse.json({ success: true, created, total: toInsert.length });
}
