import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { requests, assignments, users, bases, userRoles, checkins } from "@/db/schema";
import { eq, and, ne, inArray } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { checkSlotAvailability } from "@/lib/slots";
import { z } from "zod/v4";

const swapSchema = z.object({
  type: z.literal("SWAP"),
  assignmentId: z.string().uuid(),
  targetInternId: z.string().uuid(),
  targetAssignmentId: z.string().uuid(),
});

const extraShiftSchema = z.object({
  type: z.literal("EXTRA_SHIFT"),
  assignmentId: z.string().uuid(),
  extraBaseId: z.string().uuid(),
  extraDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  extraPeriod: z.enum(["DAY", "NIGHT"]),
});

const dropShiftSchema = z.object({
  type: z.literal("DROP_SHIFT"),
  assignmentId: z.string().uuid(),
});

const requestSchema = z.discriminatedUnion("type", [swapSchema, extraShiftSchema, dropShiftSchema]);

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

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
      targetInternId: requests.targetInternId,
      targetAssignmentId: requests.targetAssignmentId,
      extraBaseId: requests.extraBaseId,
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
    .orderBy(requests.createdAt);

  // Filter by role
  let filtered = rows;
  if (token.role === "INTERN") {
    filtered = rows.filter((r) => r.requesterId === token.id);
  } else if (token.role === "LEADER" && token.facultyId) {
    // Leader sees only requests from interns of their own faculty
    const facultyInterns = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.role, "INTERN"), eq(userRoles.facultyId, token.facultyId as string)));
    const facultyInternIds = new Set(facultyInterns.map((r) => r.userId));
    filtered = rows.filter((r) => facultyInternIds.has(r.requesterId));
  }

  // Coordinator can filter by specific intern
  const { searchParams } = new URL(req.url);
  const internId = searchParams.get("internId");
  if (token.role === "COORDINATOR" && internId) {
    filtered = rows.filter((r) => r.requesterId === internId);
  }

  return NextResponse.json({ success: true, data: filtered });
}

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const data = parsed.data;

  // Coordinator can create requests on behalf of an intern
  let requesterId = token.id as string;
  const onBehalfOf = (body as { onBehalfOf?: string }).onBehalfOf;
  if (token.role === "COORDINATOR" && onBehalfOf) {
    requesterId = onBehalfOf;
  }

  // BUG-3 FIX: Validate assignment belongs to the requester
  const [ownerAssignment] = await db
    .select({ id: assignments.id, internId: assignments.internId, status: assignments.status, date: assignments.date })
    .from(assignments)
    .where(eq(assignments.id, data.assignmentId))
    .limit(1);

  if (!ownerAssignment) {
    return NextResponse.json({ success: false, error: "Assignment não encontrado" }, { status: 404 });
  }
  if (ownerAssignment.internId !== requesterId) {
    return NextResponse.json({ success: false, error: "Esse plantão não pertence a você" }, { status: 403 });
  }

  // Validate assignment is in the future and SCHEDULED
  const todayStr = new Date().toISOString().slice(0, 10);
  if (ownerAssignment.date < todayStr) {
    return NextResponse.json({ success: false, error: "Não é possível solicitar alteração de plantão passado" }, { status: 400 });
  }
  if (!["SCHEDULED", "CONFIRMED"].includes(ownerAssignment.status)) {
    return NextResponse.json({ success: false, error: `Plantão com status '${ownerAssignment.status}' não pode ser alterado` }, { status: 400 });
  }

  // BUG-5 FIX: Prevent duplicate pending requests for same assignment
  const [existingReq] = await db
    .select({ id: requests.id })
    .from(requests)
    .where(
      and(
        eq(requests.assignmentId, data.assignmentId),
        eq(requests.status, "PENDING"),
      ),
    )
    .limit(1);

  if (existingReq) {
    return NextResponse.json({ success: false, error: "Já existe uma solicitação pendente para este plantão" }, { status: 409 });
  }

  // BUG-4 FIX: Validate SWAP target
  if (data.type === "SWAP") {
    if (data.targetInternId === requesterId) {
      return NextResponse.json({ success: false, error: "Não é possível trocar consigo mesmo" }, { status: 400 });
    }

    const [targetAssignment] = await db
      .select({ id: assignments.id, internId: assignments.internId, status: assignments.status, date: assignments.date })
      .from(assignments)
      .where(eq(assignments.id, data.targetAssignmentId))
      .limit(1);

    if (!targetAssignment) {
      return NextResponse.json({ success: false, error: "Assignment alvo não encontrado" }, { status: 404 });
    }
    if (targetAssignment.internId !== data.targetInternId) {
      return NextResponse.json({ success: false, error: "O plantão alvo não pertence ao interno indicado" }, { status: 400 });
    }
    if (targetAssignment.date < todayStr) {
      return NextResponse.json({ success: false, error: "O plantão alvo já passou" }, { status: 400 });
    }
    if (!["SCHEDULED", "CONFIRMED"].includes(targetAssignment.status)) {
      return NextResponse.json({ success: false, error: `Plantão alvo com status '${targetAssignment.status}' não pode ser trocado` }, { status: 400 });
    }

    // Check no pending request on target assignment either
    const [existingTargetReq] = await db
      .select({ id: requests.id })
      .from(requests)
      .where(
        and(
          eq(requests.assignmentId, data.targetAssignmentId),
          eq(requests.status, "PENDING"),
        ),
      )
      .limit(1);

    if (existingTargetReq) {
      return NextResponse.json({ success: false, error: "O plantão alvo já tem uma solicitação pendente" }, { status: 409 });
    }
  }

  const insertData = {
    type: data.type,
    requesterId,
    assignmentId: data.assignmentId,
    targetInternId: data.type === "SWAP" ? data.targetInternId : null,
    targetAssignmentId: data.type === "SWAP" ? data.targetAssignmentId : null,
    extraBaseId: data.type === "EXTRA_SHIFT" ? data.extraBaseId : null,
    extraDate: data.type === "EXTRA_SHIFT" ? data.extraDate : null,
    extraPeriod: data.type === "EXTRA_SHIFT" ? data.extraPeriod : null,
  };

  const [created] = await db.insert(requests).values(insertData).returning();
  await logAudit({ userId: token.id as string, action: onBehalfOf ? "CREATE_REQUEST_ON_BEHALF" : "CREATE_REQUEST", entity: "request", entityId: created.id, payload: { ...data, onBehalfOf: onBehalfOf ?? null } });
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

// Leader/Coordinator review
export async function PUT(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || !["COORDINATOR", "LEADER"].includes(token.role as string)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const { id, status, reviewNotes } = body;
  if (!id || !["APPROVED", "REJECTED", "ESCALATED"].includes(status)) {
    return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  }

  const [request] = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
  if (!request) return NextResponse.json({ success: false, error: "Solicitação não encontrada" }, { status: 404 });
  if (request.status !== "PENDING" && request.status !== "ESCALATED") {
    return NextResponse.json({ success: false, error: `Solicitação já processada (status: ${request.status})` }, { status: 409 });
  }

  // Leader can only review requests from their faculty
  if (token.role === "LEADER" && token.facultyId) {
    const [reqRole] = await db
      .select({ facultyId: userRoles.facultyId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, request.requesterId), eq(userRoles.role, "INTERN")))
      .limit(1);
    if (!reqRole || reqRole.facultyId !== token.facultyId) {
      return NextResponse.json({ success: false, error: "Sem permissão para analisar esta solicitação" }, { status: 403 });
    }
  }

  // Determine final status (COMPLETED if APPROVED and successfully processed)
  let finalStatus = status;

  // Process approval
  if (status === "APPROVED") {
    if (request.type === "SWAP" && request.targetAssignmentId) {
      const [origAssignment] = await db.select().from(assignments).where(eq(assignments.id, request.assignmentId));
      const [targetAssignment] = await db.select().from(assignments).where(eq(assignments.id, request.targetAssignmentId));

      if (!origAssignment || !targetAssignment) {
        return NextResponse.json({ success: false, error: "Assignments originais não encontrados" }, { status: 404 });
      }

      // Validate both are still SCHEDULED/CONFIRMED
      if (!["SCHEDULED", "CONFIRMED"].includes(origAssignment.status) ||
          !["SCHEDULED", "CONFIRMED"].includes(targetAssignment.status)) {
        return NextResponse.json({ success: false, error: "Um dos plantões já foi alterado e não pode ser trocado" }, { status: 409 });
      }

      // BUG-12: Check no active checkins on either assignment  
      const [origCheckin] = await db
        .select({ id: checkins.id })
        .from(checkins)
        .where(eq(checkins.assignmentId, origAssignment.id))
        .limit(1);
      const [targetCheckin] = await db
        .select({ id: checkins.id })
        .from(checkins)
        .where(eq(checkins.assignmentId, targetAssignment.id))
        .limit(1);
      if (origCheckin || targetCheckin) {
        return NextResponse.json({ success: false, error: "Um dos plantões já possui check-in e não pode ser trocado" }, { status: 409 });
      }

      // Cancel both originals and create swapped ones
      await db.update(assignments).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(assignments.id, origAssignment.id));
      await db.update(assignments).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(assignments.id, targetAssignment.id));

      await db.insert(assignments).values({
        internId: origAssignment.internId,
        facultyId: origAssignment.facultyId,
        baseId: targetAssignment.baseId,
        date: targetAssignment.date,
        period: targetAssignment.period,
        createdBy: token.id as string,
      });
      await db.insert(assignments).values({
        internId: targetAssignment.internId,
        facultyId: targetAssignment.facultyId,
        baseId: origAssignment.baseId,
        date: origAssignment.date,
        period: origAssignment.period,
        createdBy: token.id as string,
      });

      finalStatus = "COMPLETED";
    } else if (request.type === "EXTRA_SHIFT" && request.extraBaseId && request.extraDate && request.extraPeriod) {
      const [origAssignment] = await db.select().from(assignments).where(eq(assignments.id, request.assignmentId));
      if (!origAssignment) {
        return NextResponse.json({ success: false, error: "Assignment original não encontrado" }, { status: 404 });
      }

      // BUG-7 FIX: Check slot availability for the extra shift
      const slot = await checkSlotAvailability(
        request.extraBaseId,
        request.extraDate,
        request.extraPeriod as "DAY" | "NIGHT",
        origAssignment.facultyId,
      );
      if (!slot.available) {
        return NextResponse.json({
          success: false,
          error: `Sem vaga disponível para o plantão extra (${slot.assigned}/${slot.capacity})`,
        }, { status: 409 });
      }

      await db.insert(assignments).values({
        internId: request.requesterId,
        facultyId: origAssignment.facultyId,
        baseId: request.extraBaseId,
        date: request.extraDate,
        period: request.extraPeriod,
        createdBy: token.id as string,
      });

      finalStatus = "COMPLETED";
    } else if (request.type === "DROP_SHIFT") {
      // BUG-12: Check no active checkin
      const [existingCheckin] = await db
        .select({ id: checkins.id })
        .from(checkins)
        .where(eq(checkins.assignmentId, request.assignmentId))
        .limit(1);
      if (existingCheckin) {
        return NextResponse.json({ success: false, error: "Plantão já possui check-in e não pode ser descartado" }, { status: 409 });
      }

      await db.update(assignments).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(assignments.id, request.assignmentId));
      finalStatus = "COMPLETED";
    }
  }

  const [updated] = await db
    .update(requests)
    .set({ status: finalStatus, reviewedBy: token.id as string, reviewedAt: new Date(), reviewNotes })
    .where(eq(requests.id, id))
    .returning();

  await logAudit({ userId: token.id as string, action: `REVIEW_REQUEST_${status}`, entity: "request", entityId: id, payload: { status: finalStatus, reviewNotes } });
  return NextResponse.json({ success: true, data: updated });
}
