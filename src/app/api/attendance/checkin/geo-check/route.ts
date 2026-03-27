import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { assignments, bases } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { isWithinGeofence } from "@/lib/geo";
import { z } from "zod/v4";

const schema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    assignmentId: z.string().uuid(),
});

function getEffectiveInternId(req: NextRequest, token: { id?: unknown; role?: unknown }): string {
    const isCoordImpersonating = token.role === "COORDINATOR" &&
        !!(req.cookies.get("x-impersonate-user")?.value || req.headers.get("x-impersonate-user"));
    if (isCoordImpersonating) {
        return (req.cookies.get("x-impersonate-user")?.value || req.headers.get("x-impersonate-user"))!;
    }
    return token.id as string;
}

export async function POST(req: NextRequest) {
    const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
    if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

    const { latitude, longitude, assignmentId } = parsed.data;
    const effectiveInternId = getEffectiveInternId(req, token);

    // Impersonating coordinators bypass geo check
    const impersonating = token.role === "COORDINATOR" &&
        !!(req.cookies.get("x-impersonate-user")?.value || req.headers.get("x-impersonate-user"));
    if (impersonating) {
        return NextResponse.json({
            success: true,
            withinFence: true,
            distanceMeters: 0,
            geoFenceMeters: 0,
        });
    }

    const [assignment] = await db.select().from(assignments)
        .where(and(eq(assignments.id, assignmentId), eq(assignments.internId, effectiveInternId)))
        .limit(1);
    if (!assignment) return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });

    const [base] = await db.select().from(bases).where(eq(bases.id, assignment.baseId)).limit(1);
    if (!base) return NextResponse.json({ success: false, error: "Base não encontrada" }, { status: 404 });

    const geo = isWithinGeofence(latitude, longitude, base.latitude, base.longitude, base.geoFenceMeters);

    return NextResponse.json({
        success: true,
        withinFence: geo.valid,
        distanceMeters: geo.distance,
        geoFenceMeters: base.geoFenceMeters,
    });
}
