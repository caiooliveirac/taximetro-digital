import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assignments, checkins, qrSessions, users, bases, faculties, userRoles } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
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
  observations: z.string().max(2000).optional(),
});

function normalizeObservation(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function shouldUseUnifiedShiftCheckout(assignment: { period: string; shift: string | null }) {
  return assignment.period === "DAY" && (assignment.shift === "MORNING" || assignment.shift === "AFTERNOON");
}

async function resolveUnifiedCheckoutAssignmentIds(assignment: {
  id: string;
  internId: string;
  date: string;
  period: string;
  shift: string | null;
}) {
  if (!shouldUseUnifiedShiftCheckout(assignment)) return [assignment.id];

  const related = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.internId, assignment.internId),
        eq(assignments.date, assignment.date),
        eq(assignments.period, "DAY"),
        inArray(assignments.shift, ["MORNING", "AFTERNOON"]),
        eq(assignments.status, "CHECKED_IN"),
      ),
    );

  const ids = related.map((row) => row.id);
  if (!ids.includes(assignment.id)) ids.push(assignment.id);
  return ids;
}

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
  const observations = normalizeObservation(parsed.data.observations);

  if (assignmentId) {
    const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
    if (!assignment) return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });

    if (assignment.status === "CHECKED_OUT" || assignment.status === "CANCELLED") {
      return NextResponse.json({ success: false, error: "Plantão já encerrado ou cancelado" }, { status: 400 });
    }

    const validatorId = user.realUserId ?? user.id;
    const now = new Date();

    const [checkin] = await db.select().from(checkins).where(eq(checkins.assignmentId, assignmentId)).limit(1);
    let checkinId = checkin?.id;

    if (!checkin) {
      const [created] = await db.insert(checkins).values({
        assignmentId,
        internId: assignment.internId,
        checkinAt: now,
        status: "VALIDATED",
        validatedBy: validatorId,
        totpValidatedAt: now,
        method: "APP_DIRECT",
        preceptorObservations: observations,
      }).returning({ id: checkins.id });
      checkinId = created.id;
    } else if (checkin.status === "PENDING") {
      await db.update(checkins).set({
        status: "VALIDATED",
        validatedBy: validatorId,
        totpValidatedAt: now,
        method: "APP_DIRECT",
        preceptorObservations: observations,
      }).where(eq(checkins.id, checkin.id));
      checkinId = checkin.id;
    } else if (checkin.status === "VALIDATED") {
      checkinId = checkin.id;
    } else {
      return NextResponse.json({ success: false, error: "Check-in já processado para este plantão" }, { status: 400 });
    }

    await db.update(assignments).set({ status: "CHECKED_IN", updatedAt: now }).where(eq(assignments.id, assignmentId));

    if (checkinId) {
      await db.update(qrSessions).set({ consumedAt: now, consumedBy: validatorId })
        .where(and(eq(qrSessions.checkinId, checkinId)));
    }

    await logAudit({
      userId: validatorId,
      action: "CHECKIN_VALIDATED_APP",
      entity: "checkin",
      entityId: checkinId,
      ...((user.isImpersonating || observations) ? {
        payload: {
          ...(user.isImpersonating ? { impersonating: user.id } : {}),
          ...(observations ? { hasObservations: true } : {}),
        },
      } : {}),
    });

    return NextResponse.json({ success: true, data: { method: "APP_DIRECT" } });
  }

  if (code) {
    return validateByCode(code, user.realUserId ?? user.id, user.isImpersonating ? user.id : undefined, observations);
  }

  return NextResponse.json({ success: false, error: "Informe assignmentId ou code" }, { status: 400 });
}

async function validateByCode(code: string, validatorId: string, impersonatingId?: string, observations?: string | null) {
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

  const now = new Date();

  // Checkout flow: code generated from /attendance/checkout must close an active CHECKED_IN shift.
  if (checkin.status === "VALIDATED") {
    if (assignment.status !== "CHECKED_IN") {
      return NextResponse.json({ success: false, error: "Plantão não está em check-in ativo para checkout" }, { status: 400 });
    }

    const assignmentIdsToCheckout = await resolveUnifiedCheckoutAssignmentIds(assignment);

    await db.update(checkins).set({
      checkoutAt: now,
      checkoutConfirmedBy: validatorId,
      checkoutNotes: observations ?? null,
    }).where(inArray(checkins.assignmentId, assignmentIdsToCheckout));

    await db.update(qrSessions).set({ consumedAt: now, consumedBy: validatorId }).where(eq(qrSessions.id, session.id));
    await db.update(assignments).set({ status: "CHECKED_OUT", updatedAt: now }).where(inArray(assignments.id, assignmentIdsToCheckout));

    await logAudit({
      userId: validatorId,
      action: "CHECKOUT_CONFIRMED",
      entity: "assignment",
      entityId: assignment.id,
      ...((impersonatingId || observations || assignmentIdsToCheckout.length > 1) ? {
        payload: {
          via: "CODE",
          ...(impersonatingId ? { impersonating: impersonatingId } : {}),
          ...(observations ? { hasObservations: true } : {}),
          ...(assignmentIdsToCheckout.length > 1 ? { unified: true, assignmentIds: assignmentIdsToCheckout } : {}),
        },
      } : { payload: { via: "CODE" } }),
    });

    return NextResponse.json({ success: true, data: { method: "CODE", flow: "CHECKOUT", assignmentIds: assignmentIdsToCheckout } });
  }

  await db.update(checkins).set({
    status: "VALIDATED",
    validatedBy: validatorId,
    totpValidatedAt: now,
    method: "APP_DIRECT",
    preceptorObservations: observations ?? null,
  }).where(eq(checkins.id, session.checkinId));

  await db.update(qrSessions).set({ consumedAt: now, consumedBy: validatorId }).where(eq(qrSessions.id, session.id));
  await db.update(assignments).set({ status: "CHECKED_IN", updatedAt: now }).where(eq(assignments.id, checkin.assignmentId));

  await logAudit({
    userId: validatorId,
    action: "CHECKIN_VALIDATED_CODE",
    entity: "checkin",
    entityId: session.checkinId,
    ...((impersonatingId || observations) ? {
      payload: {
        ...(impersonatingId ? { impersonating: impersonatingId } : {}),
        ...(observations ? { hasObservations: true } : {}),
      },
    } : {}),
  });

  return NextResponse.json({ success: true, data: { method: "CODE", flow: "CHECKIN" } });
}
