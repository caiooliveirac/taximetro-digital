import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { assignments, users, bases, faculties, checkins } from "@/db/schema";
import { eq, and, gte, lte, ne } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { checkSlotAvailability } from "@/lib/slots";
import { z } from "zod/v4";

const createAssignmentSchema = z.object({
  internId: z.string().uuid(),
  facultyId: z.string().uuid(),
  baseId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.enum(["DAY", "NIGHT"]),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("from");
  const dateTo = searchParams.get("to");
  const facultyId = searchParams.get("facultyId");
  const baseId = searchParams.get("baseId");
  const period = searchParams.get("period");
  const internId = searchParams.get("internId");

  let query = db
    .select({
      id: assignments.id,
      internId: assignments.internId,
      internName: users.name,
      facultyId: assignments.facultyId,
      facultyAbbr: faculties.abbreviation,
      baseId: assignments.baseId,
      baseCode: bases.code,
      baseName: bases.name,
      baseType: bases.type,
      baseLatitude: bases.latitude,
      baseLongitude: bases.longitude,
      date: assignments.date,
      period: assignments.period,
      status: assignments.status,
      notes: assignments.notes,
      createdAt: assignments.createdAt,
      checkinGeoValid: checkins.geoValid,
      checkinStatus: checkins.status,
      checkinMethod: checkins.method,
    })
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.internId))
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
    .leftJoin(checkins, eq(checkins.assignmentId, assignments.id))
    .orderBy(assignments.date, assignments.period)
    .$dynamic();

  const conditions = [];
  if (dateFrom) conditions.push(gte(assignments.date, dateFrom));
  if (dateTo) conditions.push(lte(assignments.date, dateTo));

  // Leaders see only their faculty
  if (token.role === "LEADER" && token.facultyId) {
    conditions.push(eq(assignments.facultyId, token.facultyId as string));
  } else if (facultyId) {
    conditions.push(eq(assignments.facultyId, facultyId));
  }

  // Interns see only their own
  if (token.role === "INTERN") {
    conditions.push(eq(assignments.internId, token.id as string));
  }

  // Coordinator can filter by specific intern
  if (token.role === "COORDINATOR" && internId) {
    conditions.push(eq(assignments.internId, internId));
  }

  // Preceptors must filter by base (declared base sent from client)
  if (token.role === "PRECEPTOR") {
    if (baseId) {
      conditions.push(eq(assignments.baseId, baseId));
    }
    if (period && (period === "DAY" || period === "NIGHT")) {
      conditions.push(eq(assignments.period, period));
    }
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const rows = await query;
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || !["COORDINATOR", "LEADER"].includes(token.role as string)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createAssignmentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  // Leader can only create for their faculty
  if (token.role === "LEADER" && parsed.data.facultyId !== token.facultyId) {
    return NextResponse.json({ success: false, error: "Só pode alocar internos da sua faculdade" }, { status: 403 });
  }

  // Check slot availability
  const slot = await checkSlotAvailability(
    parsed.data.baseId,
    parsed.data.date,
    parsed.data.period,
    parsed.data.facultyId,
  );
  if (!slot.available) {
    return NextResponse.json({ success: false, error: `Sem vaga (${slot.assigned}/${slot.capacity})` }, { status: 409 });
  }

  const [created] = await db
    .insert(assignments)
    .values({ ...parsed.data, createdBy: token.id as string })
    .returning();

  await logAudit({
    userId: token.id as string,
    action: "CREATE_ASSIGNMENT",
    entity: "assignment",
    entityId: created.id,
    payload: parsed.data,
  });

  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || !["COORDINATOR", "LEADER"].includes(token.role as string)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const { id, status, notes } = body;
  if (!id) return NextResponse.json({ success: false, error: "ID obrigatório" }, { status: 400 });

  const [updated] = await db
    .update(assignments)
    .set({ status, notes, updatedAt: new Date() })
    .where(eq(assignments.id, id))
    .returning();

  if (!updated) return NextResponse.json({ success: false, error: "Assignment não encontrado" }, { status: 404 });

  await logAudit({ userId: token.id as string, action: "UPDATE_ASSIGNMENT", entity: "assignment", entityId: id, payload: { status, notes } });
  return NextResponse.json({ success: true, data: updated });
}
