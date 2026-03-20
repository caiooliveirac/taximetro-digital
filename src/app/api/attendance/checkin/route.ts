import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { assignments, bases, checkins, qrSessions, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { isWithinGeofence } from "@/lib/geo";
import { generateUniqueCode, CODE_TTL_SECONDS } from "@/lib/totp";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";
import QRCode from "qrcode";

const checkinSchema = z.object({
  assignmentId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  const parsed = checkinSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const { assignmentId, latitude, longitude } = parsed.data;

  // Fetch assignment + base
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, assignmentId), eq(assignments.internId, token.id as string)))
    .limit(1);

  if (!assignment) return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });
  if (assignment.status !== "SCHEDULED" && assignment.status !== "CONFIRMED") {
    return NextResponse.json({ success: false, error: "Check-in já realizado ou cancelado" }, { status: 400 });
  }

  const [base] = await db.select().from(bases).where(eq(bases.id, assignment.baseId)).limit(1);
  if (!base) return NextResponse.json({ success: false, error: "Base não encontrada" }, { status: 404 });

  // Shift period validation
  const hour = new Date().getHours();
  const isDayShift = assignment.period === "DAY";
  if (isDayShift && (hour >= 20 || hour < 4)) {
    return NextResponse.json({ success: false, error: "Fora do horário do turno diurno (05h–20h)" }, { status: 400 });
  }
  if (!isDayShift && (hour >= 8 && hour < 17)) {
    return NextResponse.json({ success: false, error: "Fora do horário do turno noturno (17h–08h)" }, { status: 400 });
  }

  // Geofence check
  const geo = isWithinGeofence(latitude, longitude, base.latitude, base.longitude, base.geoFenceMeters);
  if (!geo.valid) {
    await logAudit({
      userId: token.id as string,
      action: "CHECKIN_GEO_REJECTED",
      entity: "assignment",
      entityId: assignmentId,
      payload: { distance: geo.distance, fence: base.geoFenceMeters },
    });
    return NextResponse.json({
      success: false,
      error: `Fora do raio de geofence (${geo.distance}m, máximo ${base.geoFenceMeters}m)`,
    }, { status: 400 });
  }

  // Generate unique 6-digit code (5-min TTL)
  const code = await generateUniqueCode();
  const now = new Date();
  const codeExpiresAt = new Date(now.getTime() + CODE_TTL_SECONDS * 1000);

  // Create checkin record
  const [checkin] = await db.insert(checkins).values({
    assignmentId,
    internId: token.id as string,
    checkinLat: latitude,
    checkinLng: longitude,
    geoDistanceMeters: geo.distance,
    geoValid: true,
    checkinAt: now,
    totpSecret: code, // store code for reference
    status: "PENDING",
  }).returning();

  // Create QR session
  await db.insert(qrSessions).values({
    checkinId: checkin.id,
    internId: token.id as string,
    totpSecret: code,
    activeCode: code,
    codeExpiresAt,
    expiresAt: codeExpiresAt,
  });

  // Get intern selfie for display
  const [intern] = await db.select({ selfie: users.selfie, name: users.name })
    .from(users).where(eq(users.id, token.id as string)).limit(1);

  // Generate QR code (deep link to Telegram bot)
  const botUrl = `https://t.me/Taximetros_bot?start=${code}`;
  const qrDataUrl = await QRCode.toDataURL(botUrl, { width: 300, margin: 2 });

  await logAudit({
    userId: token.id as string,
    action: "CHECKIN_INITIATED",
    entity: "checkin",
    entityId: checkin.id,
    payload: { distance: geo.distance },
  });

  return NextResponse.json({
    success: true,
    data: {
      checkinId: checkin.id,
      code,
      qrDataUrl,
      expiresAt: codeExpiresAt.toISOString(),
      geoDistance: geo.distance,
      selfie: intern?.selfie ?? null,
      internName: intern?.name ?? "",
    },
  });
}
