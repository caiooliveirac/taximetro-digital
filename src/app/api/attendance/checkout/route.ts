import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { assignments, bases, checkins, qrSessions, users } from "@/db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { getEffectiveUser } from "@/lib/impersonate";
import { generateTotpSecret, getCurrentCode } from "@/lib/totp";
import { SESSION_TTL_SECONDS } from "@/lib/totp-config";
import { isWithinShiftCheckoutWindow, getShiftLabel } from "@/lib/utils";
import { z } from "zod/v4";

// GET: return checkin details for a CHECKED_IN assignment
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const assignmentId = req.nextUrl.searchParams.get("assignmentId");
  if (!assignmentId) return NextResponse.json({ success: false, error: "assignmentId obrigatório" }, { status: 400 });

  const [checkin] = await db.select({ checkinAt: checkins.checkinAt })
    .from(checkins)
    .where(eq(checkins.assignmentId, assignmentId))
    .limit(1);

  if (!checkin) return NextResponse.json({ success: false, error: "Checkin não encontrado" }, { status: 404 });

  return NextResponse.json({ success: true, data: { checkinAt: checkin.checkinAt?.toISOString() ?? null } });
}

function isImpersonating(req: NextRequest, token: { role?: unknown }): boolean {
  return token.role === "COORDINATOR" &&
    !!(req.cookies.get("x-impersonate-user")?.value || req.headers.get("x-impersonate-user"));
}

const checkoutSchema = z.object({
  assignmentId: z.string().uuid(),
});

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

// POST: Intern initiates checkout — generates TOTP for preceptor validation via Telegram
export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const impersonating = isImpersonating(req, token);
  const effectiveInternId = impersonating
    ? (req.cookies.get("x-impersonate-user")?.value || req.headers.get("x-impersonate-user"))!
    : token.id as string;

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: "Corpo inválido" }, { status: 400 });
  }
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const { assignmentId } = parsed.data;

  const [assignment] = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, assignmentId), eq(assignments.internId, effectiveInternId)))
    .limit(1);

  if (!assignment) return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });
  if (assignment.status !== "CHECKED_IN") {
    return NextResponse.json({ success: false, error: "Check-in não realizado" }, { status: 400 });
  }
  if (!isWithinShiftCheckoutWindow(assignment.date, assignment.period as "DAY" | "NIGHT", assignment.shift)) {
    const shiftInfo = assignment.shift ? ` (${getShiftLabel(assignment.shift)})` : "";
    return NextResponse.json(
      {
        success: false, error: assignment.period === "DAY"
          ? (assignment.shift === "MORNING"
            ? "O checkout do turno da manhã só fica liberado entre 11:00 e 00:00."
            : `O checkout do plantão diurno${shiftInfo} só fica liberado entre 15:00 e 00:00.`)
          : "O checkout do plantão noturno só fica liberado entre 06:00 e 12:00."
      },
      { status: 409 },
    );
  }

  // Find validated checkin
  const [checkin] = await db.select().from(checkins)
    .where(and(eq(checkins.assignmentId, assignmentId), eq(checkins.status, "VALIDATED")))
    .limit(1);

  if (!checkin) return NextResponse.json({ success: false, error: "Checkin validado não encontrado" }, { status: 400 });

  // Expire any existing non-consumed qrSessions for this checkin
  await db.update(qrSessions).set({ consumedAt: new Date() })
    .where(and(eq(qrSessions.checkinId, checkin.id), isNull(qrSessions.consumedAt)));

  // Generate TOTP
  const totpSecret = generateTotpSecret();
  const currentCode = getCurrentCode(totpSecret);
  const now = new Date();
  const sessionExpiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  // Create qrSession for checkout (reuses same table — webhook distinguishes by checkin.status)
  await db.insert(qrSessions).values({
    checkinId: checkin.id,
    internId: effectiveInternId,
    totpSecret,
    activeCode: currentCode,
    codeExpiresAt: sessionExpiresAt,
    expiresAt: sessionExpiresAt,
  });

  const [intern] = await db.select({ name: users.name }).from(users).where(eq(users.id, effectiveInternId)).limit(1);
  const [base] = await db.select({ code: bases.code, name: bases.name }).from(bases).where(eq(bases.id, assignment.baseId)).limit(1);

  await logAudit({
    userId: effectiveInternId,
    action: "CHECKOUT_INITIATED",
    entity: "checkin",
    entityId: checkin.id,
    payload: { impersonatedBy: impersonating ? (token.id as string) : undefined },
  });

  return NextResponse.json({
    success: true,
    data: {
      checkinId: checkin.id,
      currentCode,
      expiresAt: sessionExpiresAt.toISOString(),
      assignmentId,
      checkinAt: checkin.checkinAt?.toISOString() ?? null,
      internName: intern?.name ?? "",
      baseCode: base?.code ?? "",
      baseName: base?.name ?? "",
    },
  });
}

// PUT: Preceptor/Coordinator confirms checkout directly (via UI)
export async function PUT(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "PRECEPTOR"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const { assignmentId, notes } = body;
  if (!assignmentId) return NextResponse.json({ success: false, error: "assignmentId obrigatório" }, { status: 400 });

  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  if (!assignment) return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });
  if (assignment.status !== "CHECKED_IN") {
    return NextResponse.json({ success: false, error: "Interno não está em check-in" }, { status: 400 });
  }

  const assignmentIdsToCheckout = await resolveUnifiedCheckoutAssignmentIds(assignment);
  const now = new Date();

  await db.update(assignments)
    .set({ status: "CHECKED_OUT", updatedAt: now })
    .where(inArray(assignments.id, assignmentIdsToCheckout));

  await db.update(checkins).set({
    checkoutAt: now,
    checkoutConfirmedBy: user.realUserId ?? user.id,
    checkoutNotes: notes ?? null,
  }).where(inArray(checkins.assignmentId, assignmentIdsToCheckout));

  await logAudit({
    userId: user.realUserId ?? user.id,
    action: "CHECKOUT_CONFIRMED",
    entity: "assignment",
    entityId: assignmentId,
    ...((user.isImpersonating || assignmentIdsToCheckout.length > 1)
      ? {
        payload: {
          ...(user.isImpersonating ? { impersonating: user.id } : {}),
          ...(assignmentIdsToCheckout.length > 1 ? { unified: true, assignmentIds: assignmentIdsToCheckout } : {}),
        },
      }
      : {}),
  });

  return NextResponse.json({ success: true, data: { assignmentIds: assignmentIdsToCheckout } });
}
