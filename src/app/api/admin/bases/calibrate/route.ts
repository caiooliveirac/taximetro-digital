import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { bases } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";

const calibrateSchema = z.object({
  baseId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const ALLOWED_ROLES = ["COORDINATOR"];

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || !ALLOWED_ROLES.includes(token.role as string)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = calibrateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const { baseId, latitude, longitude } = parsed.data;

  const [base] = await db.select().from(bases).where(eq(bases.id, baseId));
  if (!base) {
    return NextResponse.json({ success: false, error: "Base não encontrada" }, { status: 404 });
  }

  const [updated] = await db
    .update(bases)
    .set({ latitude, longitude })
    .where(eq(bases.id, baseId))
    .returning();

  await logAudit({
    userId: token.id as string,
    action: "CALIBRATE_BASE",
    entity: "base",
    entityId: baseId,
    payload: {
      oldLat: base.latitude,
      oldLng: base.longitude,
      newLat: latitude,
      newLng: longitude,
    },
  });

  return NextResponse.json({ success: true, data: updated });
}
