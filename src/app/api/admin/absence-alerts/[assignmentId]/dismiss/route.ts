import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { assignments } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { logAudit } from "@/lib/audit";

// COORDINATOR-only: limpar/reabrir uma falta no card "Faltas pendentes"
// do cockpit. Não toca em status do assignment — só marca/desmarca o
// dismissed_at. Falta permanece como ABSENT em banco para relatórios.

async function requireCoordinator(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === "production",
  });
  if (!token || token.role !== "COORDINATOR") return null;
  return { id: token.id as string };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ assignmentId: string }> }) {
  const actor = await requireCoordinator(req);
  if (!actor) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const { assignmentId } = await ctx.params;
  if (!assignmentId) {
    return NextResponse.json({ success: false, error: "ID obrigatório" }, { status: 400 });
  }

  // Idempotente: aceita re-dismiss mas não sobrescreve carimbo se já estava
  // dispensado (preserva auditoria de quem fez primeiro).
  const updated = await db
    .update(assignments)
    .set({
      absenceAlertDismissedAt: new Date(),
      absenceAlertDismissedBy: actor.id,
    })
    .where(and(
      eq(assignments.id, assignmentId),
      eq(assignments.status, "ABSENT"),
      isNull(assignments.absenceAlertDismissedAt),
    ))
    .returning({ id: assignments.id });

  if (updated.length === 0) {
    return NextResponse.json(
      { success: false, error: "Falta não encontrada ou já dispensada" },
      { status: 404 },
    );
  }

  await logAudit({
    userId: actor.id,
    action: "ABSENCE_ALERT_DISMISSED",
    entity: "assignment",
    entityId: assignmentId,
    payload: {},
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ assignmentId: string }> }) {
  const actor = await requireCoordinator(req);
  if (!actor) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const { assignmentId } = await ctx.params;
  if (!assignmentId) {
    return NextResponse.json({ success: false, error: "ID obrigatório" }, { status: 400 });
  }

  // Reabre o alerta — útil se o coordenador dispensou por engano.
  const updated = await db
    .update(assignments)
    .set({
      absenceAlertDismissedAt: null,
      absenceAlertDismissedBy: null,
    })
    .where(and(
      eq(assignments.id, assignmentId),
      eq(assignments.status, "ABSENT"),
    ))
    .returning({ id: assignments.id });

  if (updated.length === 0) {
    return NextResponse.json(
      { success: false, error: "Falta não encontrada" },
      { status: 404 },
    );
  }

  await logAudit({
    userId: actor.id,
    action: "ABSENCE_ALERT_REOPENED",
    entity: "assignment",
    entityId: assignmentId,
    payload: {},
  });

  return NextResponse.json({ success: true });
}
