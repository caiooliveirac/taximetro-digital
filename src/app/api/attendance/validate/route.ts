import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assignments, checkins, qrSessions, users, bases, faculties, userRoles } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { validateCode } from "@/lib/totp";
import { logAudit } from "@/lib/audit";
import { getEffectiveUser } from "@/lib/impersonate";
import { z } from "zod/v4";

// In-memory rate limiter per validator
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= 10;
}

const validateSchema = z.object({
  checkinId: z.string().uuid().optional(),
  assignmentId: z.string().uuid().optional(),
  code: z.string().length(6).optional(),
});

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["PRECEPTOR", "COORDINATOR"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const rateLimitId = user.realUserId ?? user.id;
  if (!checkRateLimit(rateLimitId)) {
    await logAudit({ userId: rateLimitId, action: "VALIDATE_RATE_LIMITED", entity: "checkin" });
    return NextResponse.json({ success: false, error: "Muitas tentativas. Aguarde 1 minuto." }, { status: 429 });
  }

  const body = await req.json();
  const parsed = validateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const { assignmentId, code } = parsed.data;

  if (assignmentId) {
    const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
    if (!assignment) return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });

    const [checkin] = await db.select().from(checkins).where(eq(checkins.assignmentId, assignmentId)).limit(1);
    if (!checkin || checkin.status !== "PENDING") {
      return NextResponse.json({ success: false, error: "Nenhum check-in pendente para este plantão" }, { status: 400 });
    }

    const validatorId = user.realUserId ?? user.id;
    await db.update(checkins).set({
      status: "VALIDATED",
      validatedBy: validatorId,
      totpValidatedAt: new Date(),
      method: "APP_DIRECT",
    }).where(eq(checkins.id, checkin.id));

    await db.update(assignments).set({ status: "CHECKED_IN", updatedAt: new Date() }).where(eq(assignments.id, assignmentId));

    await db.update(qrSessions).set({ consumedAt: new Date(), consumedBy: validatorId })
      .where(and(eq(qrSessions.checkinId, checkin.id)));

    await logAudit({ userId: validatorId, action: "CHECKIN_VALIDATED_APP", entity: "checkin", entityId: checkin.id, ...(user.isImpersonating ? { payload: { impersonating: user.id } } : {}) });

    return NextResponse.json({ success: true, data: { method: "APP_DIRECT" } });
  }

  if (code) {
    return validateByCode(code, user.realUserId ?? user.id, user.isImpersonating ? user.id : undefined);
  }

  return NextResponse.json({ success: false, error: "Informe assignmentId ou code" }, { status: 400 });
}

async function validateByCode(code: string, validatorId: string, impersonatingId?: string) {
  // Direct DB lookup by activeCode — O(1) with index
  const session = await validateCode(code);
  if (!session) {
    await logAudit({ userId: validatorId, action: "VALIDATE_CODE_FAILED", entity: "checkin", payload: { codeLength: code.length } });
    return NextResponse.json({ success: false, error: "Código inválido ou expirado" }, { status: 400 });
  }

  const [checkin] = await db.select().from(checkins).where(eq(checkins.id, session.checkinId)).limit(1);
  if (!checkin) return NextResponse.json({ success: false, error: "Check-in não encontrado" }, { status: 404 });

  const [assignment] = await db.select().from(assignments).where(eq(assignments.id, checkin.assignmentId)).limit(1);
  if (!assignment) return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });

  await db.update(checkins).set({
    status: "VALIDATED",
    validatedBy: validatorId,
    totpValidatedAt: new Date(),
    method: "APP_DIRECT",
  }).where(eq(checkins.id, session.checkinId));

  await db.update(qrSessions).set({ consumedAt: new Date(), consumedBy: validatorId }).where(eq(qrSessions.id, session.id));
  await db.update(assignments).set({ status: "CHECKED_IN", updatedAt: new Date() }).where(eq(assignments.id, checkin.assignmentId));

  await logAudit({ userId: validatorId, action: "CHECKIN_VALIDATED_CODE", entity: "checkin", entityId: session.checkinId, ...(impersonatingId ? { payload: { impersonating: impersonatingId } } : {}) });

  return NextResponse.json({ success: true, data: { method: "CODE" } });
}
