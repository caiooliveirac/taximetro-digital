import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cruFixedAssignments, userRoles } from "@/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getEffectiveUser } from "@/lib/impersonate";
import { logAudit } from "@/lib/audit";
import { cancelCruFixedAssignments, materializeCruFixedAssignments } from "@/lib/cru-fixed";
import { localDateStr } from "@/lib/utils";
import { z } from "zod/v4";

const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

/** GET — list active CRU fixed assignments for leader's faculty */
export async function GET(req: NextRequest) {
    const user = await getEffectiveUser(req);
    if (!user || !["LEADER", "COORDINATOR"].includes(user.role) || !user.facultyId) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    const rows = await db.execute(sql`
    SELECT cfa.id, cfa.intern_id, u.name AS intern_name,
           cfa.day_of_week, cfa.period, cfa.valid_until, cfa.is_active
    FROM cru_fixed_assignments cfa
    JOIN users u ON u.id = cfa.intern_id
    WHERE cfa.faculty_id = ${user.facultyId}
      AND cfa.is_active = true
      AND cfa.valid_until >= CURRENT_DATE
    ORDER BY
      CASE cfa.day_of_week
        WHEN 'MON' THEN 0 WHEN 'TUE' THEN 1 WHEN 'WED' THEN 2
        WHEN 'THU' THEN 3 WHEN 'FRI' THEN 4 WHEN 'SAT' THEN 5 WHEN 'SUN' THEN 6
      END,
      cfa.period, u.name
  `);

    return NextResponse.json({ success: true, data: rows });
}

const addSchema = z.object({
    internId: z.string().uuid(),
    dayOfWeek: z.enum(DOW),
    period: z.enum(["DAY", "NIGHT"]),
    weeks: z.number().int().min(1).max(24).default(6),
});

/** POST — add an intern to a fixed CRU slot */
export async function POST(req: NextRequest) {
    const user = await getEffectiveUser(req);
    if (!user || !["LEADER", "COORDINATOR"].includes(user.role) || !user.facultyId) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = addSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
    }
    const { internId, dayOfWeek, period, weeks } = parsed.data;

    // Verify intern belongs to leader's faculty
    const internRole = await db
        .select({ id: userRoles.id })
        .from(userRoles)
        .where(and(
            eq(userRoles.userId, internId),
            eq(userRoles.facultyId, user.facultyId),
            inArray(userRoles.role, ["INTERN", "LEADER"]),
        ))
        .limit(1);
    if (internRole.length === 0) {
        return NextResponse.json({ success: false, error: "Interno não pertence à sua faculdade" }, { status: 400 });
    }

    // Valid for N weeks from now
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + weeks * 7);
    const validUntilStr = validUntil.toISOString().split("T")[0]!;

    try {
        const actorUserId = user.realUserId ?? user.id;

        const [existing] = await db
            .select({ id: cruFixedAssignments.id })
            .from(cruFixedAssignments)
            .where(and(
                eq(cruFixedAssignments.internId, internId),
                eq(cruFixedAssignments.dayOfWeek, dayOfWeek),
                eq(cruFixedAssignments.period, period),
            ))
            .limit(1);

        let templateId = existing?.id ?? null;

        if (existing) {
            await db
                .update(cruFixedAssignments)
                .set({
                    facultyId: user.facultyId,
                    createdBy: actorUserId,
                    validUntil: validUntilStr,
                    isActive: true,
                })
                .where(eq(cruFixedAssignments.id, existing.id));
        } else {
            const [createdTemplate] = await db.insert(cruFixedAssignments).values({
                internId,
                facultyId: user.facultyId,
                dayOfWeek,
                period,
                createdBy: actorUserId,
                validUntil: validUntilStr,
            }).returning({ id: cruFixedAssignments.id });

            templateId = createdTemplate.id;
        }

        const sync = await materializeCruFixedAssignments({
            facultyId: user.facultyId,
            startDate: localDateStr(),
            endDate: validUntilStr,
            actorUserId,
            templateIds: templateId ? [templateId] : undefined,
        });

        await logAudit({
            userId: actorUserId,
            action: "CRU_FIXED_ADD",
            entity: "cru_fixed_assignments",
            entityId: templateId ?? undefined,
            payload: {
                internId,
                dayOfWeek,
                period,
                weeks,
                materialized: sync,
                ...(user.isImpersonating ? { impersonating: user.id, impersonateRole: user.role } : {}),
            },
        });

        return NextResponse.json({ success: true, data: sync });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("uq_cru_fixed")) {
            return NextResponse.json({ success: false, error: "Interno já está cadastrado nesse dia/período" }, { status: 409 });
        }
        throw err;
    }
}

const deleteSchema = z.object({
    id: z.string().uuid(),
});

/** DELETE — remove an intern from a fixed CRU slot */
export async function DELETE(req: NextRequest) {
    const user = await getEffectiveUser(req);
    if (!user || !["LEADER", "COORDINATOR"].includes(user.role) || !user.facultyId) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id || !z.string().uuid().safeParse(id).success) {
        return NextResponse.json({ success: false, error: "ID inválido" }, { status: 400 });
    }

    const [current] = await db
        .select({
            id: cruFixedAssignments.id,
            internId: cruFixedAssignments.internId,
            facultyId: cruFixedAssignments.facultyId,
            dayOfWeek: cruFixedAssignments.dayOfWeek,
            period: cruFixedAssignments.period,
            validUntil: cruFixedAssignments.validUntil,
        })
        .from(cruFixedAssignments)
        .where(and(
            eq(cruFixedAssignments.id, id),
            eq(cruFixedAssignments.facultyId, user.facultyId),
        ))
        .limit(1);

    if (!current) {
        return NextResponse.json({ success: false, error: "Template CRU fixo não encontrado" }, { status: 404 });
    }

    await db
        .update(cruFixedAssignments)
        .set({ isActive: false })
        .where(and(
            eq(cruFixedAssignments.id, id),
            eq(cruFixedAssignments.facultyId, user.facultyId),
        ));

    const cancelled = await cancelCruFixedAssignments({
        internId: current.internId,
        dayOfWeek: current.dayOfWeek,
        period: current.period,
        startDate: localDateStr(),
        endDate: current.validUntil,
    });

    await logAudit({
        userId: user.realUserId ?? user.id,
        action: "CRU_FIXED_REMOVE",
        entity: "cru_fixed_assignments",
        entityId: id,
        payload: {
            cancelled,
            ...(user.isImpersonating ? { impersonating: user.id, impersonateRole: user.role } : {}),
        },
    });

    return NextResponse.json({ success: true, data: cancelled });
}
