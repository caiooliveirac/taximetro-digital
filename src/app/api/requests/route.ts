import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { requests, assignments, users, bases } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
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

  // Process approval
  if (status === "APPROVED") {
    if (request.type === "SWAP" && request.targetAssignmentId) {
      // Cancel both original assignments and create swapped ones
      const [origAssignment] = await db.select().from(assignments).where(eq(assignments.id, request.assignmentId));
      const [targetAssignment] = await db.select().from(assignments).where(eq(assignments.id, request.targetAssignmentId));

      if (origAssignment && targetAssignment) {
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
      }
    } else if (request.type === "EXTRA_SHIFT" && request.extraBaseId && request.extraDate && request.extraPeriod) {
      const [origAssignment] = await db.select().from(assignments).where(eq(assignments.id, request.assignmentId));
      if (origAssignment) {
        await db.insert(assignments).values({
          internId: request.requesterId,
          facultyId: origAssignment.facultyId,
          baseId: request.extraBaseId,
          date: request.extraDate,
          period: request.extraPeriod,
          createdBy: token.id as string,
        });
      }
    } else if (request.type === "DROP_SHIFT") {
      await db.update(assignments).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(assignments.id, request.assignmentId));
    }
  }

  const [updated] = await db
    .update(requests)
    .set({ status, reviewedBy: token.id as string, reviewedAt: new Date(), reviewNotes })
    .where(eq(requests.id, id))
    .returning();

  await logAudit({ userId: token.id as string, action: `REVIEW_REQUEST_${status}`, entity: "request", entityId: id, payload: { status, reviewNotes } });
  return NextResponse.json({ success: true, data: updated });
}
