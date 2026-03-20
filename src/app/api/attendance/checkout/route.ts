import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { assignments, checkins } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";

const checkoutSchema = z.object({
  assignmentId: z.string().uuid(),
  notes: z.string().optional(),
});

// Intern requests checkout
export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const { assignmentId, notes } = parsed.data;

  const [assignment] = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, assignmentId), eq(assignments.internId, token.id as string)))
    .limit(1);

  if (!assignment) return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });
  if (assignment.status !== "CHECKED_IN") {
    return NextResponse.json({ success: false, error: "Check-in não realizado" }, { status: 400 });
  }

  return NextResponse.json({ success: true, data: { assignmentId, status: "AWAITING_CHECKOUT" } });
}

// Preceptor confirms checkout (PUT)
export async function PUT(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || !["COORDINATOR", "PRECEPTOR"].includes(token.role as string)) {
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

  // Update assignment to CHECKED_OUT
  await db.update(assignments).set({ status: "CHECKED_OUT", updatedAt: new Date() }).where(eq(assignments.id, assignmentId));

  // Update checkin record
  await db.update(checkins).set({
    checkoutAt: new Date(),
    checkoutConfirmedBy: token.id as string,
    checkoutNotes: notes ?? null,
  }).where(eq(checkins.assignmentId, assignmentId));

  await logAudit({
    userId: token.id as string,
    action: "CHECKOUT_CONFIRMED",
    entity: "assignment",
    entityId: assignmentId,
  });

  return NextResponse.json({ success: true });
}
