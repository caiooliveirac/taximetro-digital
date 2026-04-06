import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { requests, assignments, users, bases, userRoles } from "@/db/schema";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { getEffectiveUser } from "@/lib/impersonate";
import { alias } from "drizzle-orm/pg-core";

/* ═══════════ GET — swap history with full tracking ═══════════ */

export async function GET(req: NextRequest) {
    const user = await getEffectiveUser(req);
    if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const internId = searchParams.get("internId");

    const requesterUser = alias(users, "requester_user");
    const targetUser = alias(users, "target_user");
    const origAssign = alias(assignments, "orig_assign");
    const origBase = alias(bases, "orig_base");
    const targetAssign = alias(assignments, "target_assign");
    const targetBase = alias(bases, "target_base");

    const rows = await db
        .select({
            id: requests.id,
            status: requests.status,
            createdAt: requests.createdAt,
            reviewedAt: requests.reviewedAt,
            // Requester (who created the swap offer)
            requesterId: requests.requesterId,
            requesterName: requesterUser.name,
            // Original assignment (what requester offered)
            origAssignmentId: origAssign.id,
            origDate: origAssign.date,
            origPeriod: origAssign.period,
            origShift: origAssign.shift,
            origBaseCode: origBase.code,
            origBaseName: origBase.name,
            origStatus: origAssign.status,
            // Target (who proposed counter)
            targetInternId: requests.targetInternId,
            targetInternName: targetUser.name,
            // Target assignment (what target offered)
            targetAssignmentId: targetAssign.id,
            targetDate: targetAssign.date,
            targetPeriod: targetAssign.period,
            targetShift: targetAssign.shift,
            targetBaseCode: targetBase.code,
            targetBaseName: targetBase.name,
            targetStatus: targetAssign.status,
        })
        .from(requests)
        .innerJoin(requesterUser, eq(requesterUser.id, requests.requesterId))
        .leftJoin(origAssign, eq(origAssign.id, requests.assignmentId))
        .leftJoin(origBase, eq(origBase.id, origAssign.baseId))
        .leftJoin(targetUser, eq(targetUser.id, requests.targetInternId))
        .leftJoin(targetAssign, eq(targetAssign.id, requests.targetAssignmentId))
        .leftJoin(targetBase, eq(targetBase.id, targetAssign.baseId))
        .where(and(
            eq(requests.type, "SWAP"),
            eq(requests.status, "COMPLETED"),
        ))
        .orderBy(desc(requests.reviewedAt));

    // Scope filtering
    let filtered = rows;

    if (internId && ["COORDINATOR", "LEADER"].includes(user.role)) {
        // Filter by specific intern (as requester OR target)
        filtered = rows.filter((r) => r.requesterId === internId || r.targetInternId === internId);
    } else if (user.role === "INTERN" || (user.role === "LEADER" && searchParams.get("selfOnly") === "true")) {
        filtered = rows.filter((r) => r.requesterId === user.id || r.targetInternId === user.id);
    } else if (user.role === "LEADER" && user.facultyId) {
        const facultyInterns = await db
            .select({ userId: userRoles.userId })
            .from(userRoles)
            .where(and(
                inArray(userRoles.role, ["INTERN", "LEADER"]),
                eq(userRoles.facultyId, user.facultyId),
                eq(userRoles.isActive, true),
            ));
        const facultyInternIds = new Set(facultyInterns.map((r) => r.userId));
        filtered = rows.filter((r) => facultyInternIds.has(r.requesterId) || (r.targetInternId && facultyInternIds.has(r.targetInternId)));
    }

    // Transform: for each swap, produce a clear "gave → received" view for each participant
    const data = filtered.map((r) => ({
        id: r.id,
        completedAt: r.reviewedAt ?? r.createdAt,
        requester: {
            id: r.requesterId,
            name: r.requesterName,
            gave: r.origBaseCode ? {
                baseCode: r.origBaseCode,
                baseName: r.origBaseName,
                date: r.origDate,
                period: r.origPeriod,
                shift: r.origShift,
                assignmentStatus: r.origStatus,
            } : null,
            received: r.targetBaseCode ? {
                baseCode: r.targetBaseCode,
                baseName: r.targetBaseName,
                date: r.targetDate,
                period: r.targetPeriod,
                shift: r.targetShift,
                assignmentStatus: r.targetStatus,
            } : null,
        },
        target: {
            id: r.targetInternId,
            name: r.targetInternName,
            gave: r.targetBaseCode ? {
                baseCode: r.targetBaseCode,
                baseName: r.targetBaseName,
                date: r.targetDate,
                period: r.targetPeriod,
                shift: r.targetShift,
                assignmentStatus: r.targetStatus,
            } : null,
            received: r.origBaseCode ? {
                baseCode: r.origBaseCode,
                baseName: r.origBaseName,
                date: r.origDate,
                period: r.origPeriod,
                shift: r.origShift,
                assignmentStatus: r.origStatus,
            } : null,
        },
    }));

    return NextResponse.json({ success: true, data });
}
