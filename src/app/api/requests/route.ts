import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { requests, assignments, users, bases, userRoles, checkins } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { checkSlotAvailability } from "@/lib/slots";
import { getEffectiveUser } from "@/lib/impersonate";
import { z } from "zod/v4";
import { alias } from "drizzle-orm/pg-core";

/* ═══════════ Validation Schemas ═══════════ */

const swapSchema = z.object({
  type: z.literal("SWAP"),
  assignmentId: z.string().uuid(),
});

const extraShiftSchema = z.object({
  type: z.literal("EXTRA_SHIFT"),
  extraBaseId: z.string().uuid(),
  extraDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  extraPeriod: z.enum(["DAY", "NIGHT"]),
});

const dropShiftSchema = z.object({
  type: z.literal("DROP_SHIFT"),
  assignmentId: z.string().uuid(),
});

const requestSchema = z.discriminatedUnion("type", [swapSchema, extraShiftSchema, dropShiftSchema]);

/* ═══════════ GET — list requests ═══════════ */

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope");

  const targetUser = alias(users, "target_user");
  const targetAssign = alias(assignments, "target_assign");
  const targetBase = alias(bases, "target_base");
  const extraBase = alias(bases, "extra_base");

  const rows = await db
    .select({
      id: requests.id,
      type: requests.type,
      requesterId: requests.requesterId,
      requesterName: users.name,
      assignmentId: requests.assignmentId,
      assignmentDate: assignments.date,
      assignmentPeriod: assignments.period,
      baseCode: bases.code,
      baseName: bases.name,
      baseType: bases.type,
      facultyId: assignments.facultyId,
      targetInternId: requests.targetInternId,
      targetInternName: targetUser.name,
      targetAssignmentId: requests.targetAssignmentId,
      targetAssignmentDate: targetAssign.date,
      targetAssignmentPeriod: targetAssign.period,
      targetBaseCode: targetBase.code,
      targetBaseName: targetBase.name,
      extraBaseId: requests.extraBaseId,
      extraBaseCode: extraBase.code,
      extraBaseName: extraBase.name,
      extraDate: requests.extraDate,
      extraPeriod: requests.extraPeriod,
      status: requests.status,
      reviewNotes: requests.reviewNotes,
      createdAt: requests.createdAt,
    })
    .from(requests)
    .innerJoin(users, eq(users.id, requests.requesterId))
    .leftJoin(assignments, eq(assignments.id, requests.assignmentId))
    .leftJoin(bases, eq(bases.id, assignments.baseId))
    .leftJoin(targetUser, eq(targetUser.id, requests.targetInternId))
    .leftJoin(targetAssign, eq(targetAssign.id, requests.targetAssignmentId))
    .leftJoin(targetBase, eq(targetBase.id, targetAssign.baseId))
    .leftJoin(extraBase, eq(extraBase.id, requests.extraBaseId))
    .orderBy(requests.createdAt);

  // Scope: open-swaps → OPEN swaps from same faculty, excluding own
  if (scope === "open-swaps" && user.role === "INTERN" && user.facultyId) {
    const facultyInterns = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.role, "INTERN"), eq(userRoles.facultyId, user.facultyId), eq(userRoles.isActive, true)));
    const facultyInternIds = new Set(facultyInterns.map((r) => r.userId));

    const filtered = rows.filter((r) =>
      r.type === "SWAP" &&
      r.status === "OPEN" &&
      facultyInternIds.has(r.requesterId) &&
      r.requesterId !== user.id,
    );
    return NextResponse.json({ success: true, data: filtered });
  }

  // Default role-based filtering
  let filtered = rows;
  if (user.role === "INTERN") {
    filtered = rows.filter((r) => r.requesterId === user.id || r.targetInternId === user.id);
  } else if (user.role === "LEADER" && user.facultyId) {
    const facultyInterns = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.role, "INTERN"), eq(userRoles.facultyId, user.facultyId)));
    const facultyInternIds = new Set(facultyInterns.map((r) => r.userId));
    filtered = rows.filter((r) => facultyInternIds.has(r.requesterId));
  }

  const internId = searchParams.get("internId");
  if (user.role === "COORDINATOR" && internId) {
    filtered = rows.filter((r) => r.requesterId === internId);
  }

  return NextResponse.json({ success: true, data: filtered });
}

/* ═══════════ POST — create request ═══════════ */

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const data = parsed.data;
  const requesterId = user.id;
  const todayStr = new Date().toISOString().slice(0, 10);

  if (data.type === "SWAP" || data.type === "DROP_SHIFT") {
    const [ownerAssignment] = await db
      .select({ id: assignments.id, internId: assignments.internId, status: assignments.status, date: assignments.date })
      .from(assignments)
      .where(eq(assignments.id, data.assignmentId))
      .limit(1);

    if (!ownerAssignment) return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });
    if (ownerAssignment.internId !== requesterId) return NextResponse.json({ success: false, error: "Esse plantão não pertence a você" }, { status: 403 });
    if (ownerAssignment.date < todayStr) return NextResponse.json({ success: false, error: "Não é possível solicitar alteração de plantão passado" }, { status: 400 });
    if (!["SCHEDULED", "CONFIRMED"].includes(ownerAssignment.status)) {
      return NextResponse.json({ success: false, error: `Plantão com status '${ownerAssignment.status}' não pode ser alterado` }, { status: 400 });
    }

    const [existingReq] = await db
      .select({ id: requests.id })
      .from(requests)
      .where(and(
        eq(requests.assignmentId, data.assignmentId),
        inArray(requests.status, ["PENDING", "OPEN"]),
      ))
      .limit(1);

    if (existingReq) return NextResponse.json({ success: false, error: "Já existe uma solicitação pendente para este plantão" }, { status: 409 });
  }

  if (data.type === "EXTRA_SHIFT") {
    if (data.extraDate < todayStr) return NextResponse.json({ success: false, error: "Data do plantão extra deve ser futura" }, { status: 400 });
    if (!user.facultyId) return NextResponse.json({ success: false, error: "Sem faculdade vinculada" }, { status: 400 });
    const slot = await checkSlotAvailability(data.extraBaseId, data.extraDate, data.extraPeriod, user.facultyId);
    if (!slot.available) {
      return NextResponse.json({ success: false, error: `Sem vaga disponível (${slot.assigned}/${slot.capacity})` }, { status: 409 });
    }
  }

  const insertData = {
    type: data.type,
    requesterId,
    assignmentId: data.type !== "EXTRA_SHIFT" ? data.assignmentId : null,
    targetInternId: null,
    targetAssignmentId: null,
    extraBaseId: data.type === "EXTRA_SHIFT" ? data.extraBaseId : null,
    extraDate: data.type === "EXTRA_SHIFT" ? data.extraDate : null,
    extraPeriod: data.type === "EXTRA_SHIFT" ? data.extraPeriod : null,
    status: data.type === "SWAP" ? ("OPEN" as const) : ("PENDING" as const),
  };

  const [created] = await db.insert(requests).values(insertData).returning();
  await logAudit({ userId: user.realUserId ?? user.id, action: "CREATE_REQUEST", entity: "request", entityId: created.id, payload: { ...data, ...(user.isImpersonating ? { impersonating: user.id, impersonateRole: user.role } : {}) } });
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

/* ═══════════ PATCH — peer-to-peer swap actions ═══════════ */

const patchSchema = z.discriminatedUnion("action", [
  z.object({ id: z.string().uuid(), action: z.literal("propose"), assignmentId: z.string().uuid() }),
  z.object({ id: z.string().uuid(), action: z.literal("confirm") }),
  z.object({ id: z.string().uuid(), action: z.literal("reject_proposal") }),
  z.object({ id: z.string().uuid(), action: z.literal("cancel") }),
]);

export async function PATCH(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const data = parsed.data;
  const userId = user.id;

  const [request] = await db.select().from(requests).where(eq(requests.id, data.id)).limit(1);
  if (!request) return NextResponse.json({ success: false, error: "Solicitação não encontrada" }, { status: 404 });
  if (request.type !== "SWAP") return NextResponse.json({ success: false, error: "Ação só permitida para trocas" }, { status: 400 });

  /* ── propose: peer offers their shift as counter ── */
  if (data.action === "propose") {
    if (request.status !== "OPEN") return NextResponse.json({ success: false, error: "Esta troca não está aberta para propostas" }, { status: 400 });
    if (request.requesterId === userId) return NextResponse.json({ success: false, error: "Não é possível propor troca consigo mesmo" }, { status: 400 });

    const [proposerAssignment] = await db
      .select({ id: assignments.id, internId: assignments.internId, status: assignments.status, date: assignments.date, facultyId: assignments.facultyId })
      .from(assignments)
      .where(eq(assignments.id, data.assignmentId))
      .limit(1);

    if (!proposerAssignment) return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });
    if (proposerAssignment.internId !== userId) return NextResponse.json({ success: false, error: "Esse plantão não pertence a você" }, { status: 403 });
    if (!["SCHEDULED", "CONFIRMED"].includes(proposerAssignment.status)) {
      return NextResponse.json({ success: false, error: "Plantão não pode ser trocado" }, { status: 400 });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    if (proposerAssignment.date < todayStr) return NextResponse.json({ success: false, error: "Plantão já passou" }, { status: 400 });

    if (request.assignmentId) {
      const [origAssignment] = await db
        .select({ facultyId: assignments.facultyId })
        .from(assignments)
        .where(eq(assignments.id, request.assignmentId))
        .limit(1);
      if (origAssignment && origAssignment.facultyId !== proposerAssignment.facultyId) {
        return NextResponse.json({ success: false, error: "Troca só é permitida dentro da mesma faculdade" }, { status: 400 });
      }
    }

    const [existingReq] = await db
      .select({ id: requests.id })
      .from(requests)
      .where(and(
        eq(requests.assignmentId, data.assignmentId),
        inArray(requests.status, ["PENDING", "OPEN"]),
      ))
      .limit(1);
    if (existingReq) return NextResponse.json({ success: false, error: "Seu plantão já está envolvido em outra solicitação pendente" }, { status: 409 });

    await db.update(requests).set({
      targetInternId: userId,
      targetAssignmentId: data.assignmentId,
      status: "PENDING",
    }).where(eq(requests.id, data.id));

    await logAudit({ userId, action: "PROPOSE_SWAP", entity: "request", entityId: data.id, payload: { assignmentId: data.assignmentId } });
    return NextResponse.json({ success: true });
  }

  /* ── confirm: requester accepts the counter-offer → swap executes ── */
  if (data.action === "confirm") {
    if (request.requesterId !== userId) return NextResponse.json({ success: false, error: "Só o solicitante pode confirmar" }, { status: 403 });
    if (request.status !== "PENDING") return NextResponse.json({ success: false, error: "Nenhuma proposta para confirmar" }, { status: 400 });
    if (!request.targetAssignmentId || !request.targetInternId || !request.assignmentId) {
      return NextResponse.json({ success: false, error: "Proposta incompleta" }, { status: 400 });
    }

    const [origAssignment] = await db.select().from(assignments).where(eq(assignments.id, request.assignmentId));
    const [targetAssignment] = await db.select().from(assignments).where(eq(assignments.id, request.targetAssignmentId));

    if (!origAssignment || !targetAssignment) return NextResponse.json({ success: false, error: "Plantões não encontrados" }, { status: 404 });
    if (!["SCHEDULED", "CONFIRMED"].includes(origAssignment.status) || !["SCHEDULED", "CONFIRMED"].includes(targetAssignment.status)) {
      return NextResponse.json({ success: false, error: "Um dos plantões já foi alterado" }, { status: 409 });
    }

    const [origCheckin] = await db.select({ id: checkins.id }).from(checkins).where(eq(checkins.assignmentId, origAssignment.id)).limit(1);
    const [targetCheckin] = await db.select({ id: checkins.id }).from(checkins).where(eq(checkins.assignmentId, targetAssignment.id)).limit(1);
    if (origCheckin || targetCheckin) {
      return NextResponse.json({ success: false, error: "Um dos plantões já possui check-in" }, { status: 409 });
    }

    await db.update(assignments).set({ status: "CANCELLED", updatedAt: new Date(), notes: "Trocado via solicitação" }).where(eq(assignments.id, origAssignment.id));
    await db.update(assignments).set({ status: "CANCELLED", updatedAt: new Date(), notes: "Trocado via solicitação" }).where(eq(assignments.id, targetAssignment.id));

    await db.insert(assignments).values({
      internId: origAssignment.internId,
      facultyId: origAssignment.facultyId,
      baseId: targetAssignment.baseId,
      date: targetAssignment.date,
      period: targetAssignment.period,
      createdBy: userId,
      notes: "Troca entre internos",
    });
    await db.insert(assignments).values({
      internId: targetAssignment.internId,
      facultyId: targetAssignment.facultyId,
      baseId: origAssignment.baseId,
      date: origAssignment.date,
      period: origAssignment.period,
      createdBy: userId,
      notes: "Troca entre internos",
    });

    await db.update(requests).set({ status: "COMPLETED", reviewedAt: new Date(), reviewNotes: "Troca confirmada por ambas partes" }).where(eq(requests.id, data.id));
    await logAudit({ userId, action: "CONFIRM_SWAP", entity: "request", entityId: data.id, payload: { origAssignmentId: origAssignment.id, targetAssignmentId: targetAssignment.id } });
    return NextResponse.json({ success: true });
  }

  /* ── reject_proposal: requester rejects the counter, reopen offer ── */
  if (data.action === "reject_proposal") {
    if (request.requesterId !== userId) return NextResponse.json({ success: false, error: "Só o solicitante pode rejeitar propostas" }, { status: 403 });
    if (request.status !== "PENDING") return NextResponse.json({ success: false, error: "Nenhuma proposta para rejeitar" }, { status: 400 });

    await db.update(requests).set({
      targetInternId: null,
      targetAssignmentId: null,
      status: "OPEN",
    }).where(eq(requests.id, data.id));

    await logAudit({ userId, action: "REJECT_SWAP_PROPOSAL", entity: "request", entityId: data.id, payload: {} });
    return NextResponse.json({ success: true });
  }

  /* ── cancel: requester cancels their request ── */
  if (data.action === "cancel") {
    if (request.requesterId !== userId) return NextResponse.json({ success: false, error: "Só o solicitante pode cancelar" }, { status: 403 });
    if (!["OPEN", "PENDING"].includes(request.status)) return NextResponse.json({ success: false, error: "Não é possível cancelar neste estado" }, { status: 400 });

    await db.update(requests).set({ status: "CANCELLED" }).where(eq(requests.id, data.id));
    await logAudit({ userId, action: "CANCEL_REQUEST", entity: "request", entityId: data.id, payload: {} });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: "Ação inválida" }, { status: 400 });
}

/* ═══════════ PUT — leader/coordinator review (DROP & EXTRA only) ═══════════ */

export async function PUT(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const { id, status, reviewNotes } = body;
  if (!id || !["APPROVED", "REJECTED", "ESCALATED"].includes(status)) {
    return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  }

  const [request] = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
  if (!request) return NextResponse.json({ success: false, error: "Solicitação não encontrada" }, { status: 404 });

  if (request.type === "SWAP") {
    return NextResponse.json({ success: false, error: "Trocas são auto-geridas entre internos" }, { status: 400 });
  }

  if (request.status !== "PENDING" && request.status !== "ESCALATED") {
    return NextResponse.json({ success: false, error: `Solicitação já processada (${request.status})` }, { status: 409 });
  }

  if (user.role === "LEADER" && user.facultyId) {
    const [reqRole] = await db
      .select({ facultyId: userRoles.facultyId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, request.requesterId), eq(userRoles.role, "INTERN")))
      .limit(1);
    if (!reqRole || reqRole.facultyId !== user.facultyId) {
      return NextResponse.json({ success: false, error: "Sem permissão para analisar esta solicitação" }, { status: 403 });
    }
  }

  let finalStatus = status;

  if (status === "APPROVED") {
    if (request.type === "EXTRA_SHIFT" && request.extraBaseId && request.extraDate && request.extraPeriod) {
      const [reqRole] = await db
        .select({ facultyId: userRoles.facultyId })
        .from(userRoles)
        .where(and(eq(userRoles.userId, request.requesterId), eq(userRoles.role, "INTERN")))
        .limit(1);
      if (!reqRole?.facultyId) {
        return NextResponse.json({ success: false, error: "Interno sem faculdade vinculada" }, { status: 400 });
      }

      const slot = await checkSlotAvailability(
        request.extraBaseId,
        request.extraDate,
        request.extraPeriod as "DAY" | "NIGHT",
        reqRole.facultyId,
      );
      if (!slot.available) {
        return NextResponse.json({ success: false, error: `Sem vaga disponível (${slot.assigned}/${slot.capacity})` }, { status: 409 });
      }

      await db.insert(assignments).values({
        internId: request.requesterId,
        facultyId: reqRole.facultyId,
        baseId: request.extraBaseId,
        date: request.extraDate,
        period: request.extraPeriod,
        createdBy: user.realUserId ?? user.id,
        notes: "Plantão extra aprovado",
      });
      finalStatus = "COMPLETED";
    } else if (request.type === "DROP_SHIFT" && request.assignmentId) {
      const [existingCheckin] = await db
        .select({ id: checkins.id })
        .from(checkins)
        .where(eq(checkins.assignmentId, request.assignmentId))
        .limit(1);
      if (existingCheckin) {
        return NextResponse.json({ success: false, error: "Plantão já possui check-in e não pode ser descartado" }, { status: 409 });
      }

      await db.update(assignments).set({ status: "CANCELLED", updatedAt: new Date(), notes: "Descartado via solicitação" }).where(eq(assignments.id, request.assignmentId));
      finalStatus = "COMPLETED";
    }
  }

  const [updated] = await db
    .update(requests)
    .set({ status: finalStatus, reviewedBy: user.realUserId ?? user.id, reviewedAt: new Date(), reviewNotes })
    .where(eq(requests.id, id))
    .returning();

  await logAudit({ userId: user.realUserId ?? user.id, action: `REVIEW_REQUEST_${status}`, entity: "request", entityId: id, payload: { status: finalStatus, reviewNotes, ...(user.isImpersonating ? { impersonating: user.id, impersonateRole: user.role } : {}) } });
  return NextResponse.json({ success: true, data: updated });
}
