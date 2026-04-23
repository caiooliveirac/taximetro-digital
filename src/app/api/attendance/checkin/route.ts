import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import type { JWT } from "next-auth/jwt";
import { db } from "@/db";
import { assignments, bases, checkins, qrSessions, users } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { isWithinGeofence } from "@/lib/geo";
import { generateTotpSecret, getCurrentCode } from "@/lib/totp";
import { logAudit } from "@/lib/audit";
import { SESSION_TTL_SECONDS } from "@/lib/totp-config";
import { validateShiftClockIn } from "@/lib/utils";
import { tokenHasRole } from "@/lib/roles";
import { canStartCheckin } from "@/lib/attendance-permissions";
import { z } from "zod/v4";

const checkinSchema = z.object({
  assignmentId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  geoValid: z.boolean().default(true),
});

function isImpersonating(req: NextRequest, token: JWT | null): boolean {
  return tokenHasRole(token, "COORDINATOR") &&
    !!(req.cookies.get("x-impersonate-user")?.value || req.headers.get("x-impersonate-user"));
}

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const impersonating = isImpersonating(req, token);

  // Guard: real user must have INTERN role ativa, OU estar impersonando (COORDINATOR já
  // vetado por impersonate.ts). Isto é o guard novo do Corte A: bloqueia LEADER-puro
  // (sem INTERN) de iniciar check-in próprio, mantendo o fluxo de impersonation.
  if (!canStartCheckin(token, impersonating)) {
    return NextResponse.json({ success: false, error: "Apenas internos fazem check-in" }, { status: 403 });
  }

  const effectiveInternId = impersonating
    ? (req.cookies.get("x-impersonate-user")?.value || req.headers.get("x-impersonate-user"))!
    : token.id as string;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Corpo da requisição inválido." }, { status: 400 });
  }
  const parsed = checkinSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: "Dados inválidos: " + parsed.error.issues.map(i => i.message).join(", ") }, { status: 400 });

  const { assignmentId, latitude, longitude, geoValid: clientGeoValid } = parsed.data;

  // Fetch assignment + base
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, assignmentId), eq(assignments.internId, effectiveInternId)))
    .limit(1);

  if (!assignment) return NextResponse.json({ success: false, error: "Plantão não encontrado para este interno." }, { status: 404 });

  // Allow SCHEDULED, CONFIRMED, or even assignments with a PENDING checkin
  if (assignment.status !== "SCHEDULED" && assignment.status !== "CONFIRMED") {
    return NextResponse.json({ success: false, error: "Check-in já realizado ou plantão cancelado." }, { status: 400 });
  }

  const [base] = await db.select().from(bases).where(eq(bases.id, assignment.baseId)).limit(1);
  if (!base) return NextResponse.json({ success: false, error: "Base não encontrada." }, { status: 404 });

  // Shift period validation — skip when impersonating (testing)
  if (!impersonating) {
    const hour = new Date().getHours();
    const clockInCheck = validateShiftClockIn(
      assignment.period as "DAY" | "NIGHT",
      assignment.shift,
      hour,
    );
    if (!clockInCheck.allowed) {
      return NextResponse.json({ success: false, error: clockInCheck.errorMessage }, { status: 400 });
    }
  }

  // Geofence check — skip when impersonating or no GPS
  const hasGps = latitude !== 0 || longitude !== 0;
  let geo = { valid: true, distance: 0 };
  if (!impersonating && hasGps) {
    geo = isWithinGeofence(latitude, longitude, base.latitude, base.longitude, base.geoFenceMeters);
  }

  // Generate TOTP secret for code rotation (5-min step, 15-min session)
  const totpSecret = generateTotpSecret();
  const currentCode = getCurrentCode(totpSecret);
  const now = new Date();
  const sessionExpiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  // Check for existing PENDING checkin for this assignment — reuse it instead of failing on unique constraint
  const [existingCheckin] = await db.select().from(checkins)
    .where(eq(checkins.assignmentId, assignmentId))
    .limit(1);

  let checkinId: string;

  if (existingCheckin && existingCheckin.status === "PENDING") {
    // Reuse existing checkin: update with new geo + TOTP data
    await db.update(checkins).set({
      checkinLat: hasGps ? latitude : null,
      checkinLng: hasGps ? longitude : null,
      geoDistanceMeters: hasGps ? geo.distance : null,
      geoValid: impersonating ? true : (hasGps ? (clientGeoValid || geo.valid) : false),
      checkinAt: now,
      totpSecret,
      status: "PENDING",
    }).where(eq(checkins.id, existingCheckin.id));
    checkinId = existingCheckin.id;

    // Expire old qr_sessions for this checkin
    await db.update(qrSessions).set({
      consumedAt: now,
      consumedBy: null,
    }).where(and(
      eq(qrSessions.checkinId, existingCheckin.id),
      isNull(qrSessions.consumedAt),
    ));
  } else if (existingCheckin) {
    // Checkin exists but is VALIDATED or another non-PENDING state
    return NextResponse.json({ success: false, error: "Check-in já realizado ou plantão cancelado." }, { status: 400 });
  } else {
    // Create new checkin record
    const [newCheckin] = await db.insert(checkins).values({
      assignmentId,
      internId: effectiveInternId,
      checkinLat: hasGps ? latitude : null,
      checkinLng: hasGps ? longitude : null,
      geoDistanceMeters: hasGps ? geo.distance : null,
      geoValid: impersonating ? true : (hasGps ? (clientGeoValid || geo.valid) : false),
      checkinAt: now,
      totpSecret,
      status: "PENDING",
    }).returning();
    checkinId = newCheckin.id;
  }

  // Create new QR session
  await db.insert(qrSessions).values({
    checkinId,
    internId: effectiveInternId,
    totpSecret,
    activeCode: currentCode,
    codeExpiresAt: sessionExpiresAt,
    expiresAt: sessionExpiresAt,
  });

  // Get intern selfie for display
  const [intern] = await db.select({ selfie: users.selfie, name: users.name })
    .from(users).where(eq(users.id, effectiveInternId)).limit(1);

  await logAudit({
    userId: effectiveInternId,
    action: "CHECKIN_INITIATED",
    entity: "checkin",
    entityId: checkinId,
    realUserId: impersonating ? (token.id as string) : undefined,
    payload: { distance: hasGps ? geo.distance : null, geoValid: hasGps ? geo.valid : false, hasGps, reused: !!existingCheckin },
  });

  return NextResponse.json({
    success: true,
    data: {
      checkinId,
      currentCode,
      expiresAt: sessionExpiresAt.toISOString(),
      assignmentId,
      geoDistance: geo.distance,
      selfie: intern?.selfie ?? null,
      internName: intern?.name ?? "",
    },
  });
}
