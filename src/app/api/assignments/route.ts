import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assignments, users, bases, faculties, checkins } from "@/db/schema";
import { eq, and, gte, lte, ne, sql } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { checkSlotAvailability, checkCruConflict } from "@/lib/slots";
import { getEffectiveUser } from "@/lib/impersonate";
import { localDateStr } from "@/lib/utils";
import { z } from "zod/v4";

const createAssignmentSchema = z.object({
  internId: z.string().uuid(),
  facultyId: z.string().uuid(),
  baseId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.enum(["DAY", "NIGHT"]),
  shift: z.enum(["MORNING", "AFTERNOON"]).nullish(),
  notes: z.string().optional(),
  allowRetroactiveOverride: z.boolean().optional(),
  allowAdminOpenAllocation: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

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
      shift: assignments.shift,
      status: assignments.status,
      notes: assignments.notes,
      absenceJustification: assignments.absenceJustification,
      absenceJustificationActor: assignments.absenceJustificationActor,
      absenceJustificationAt: assignments.absenceJustificationAt,
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
  if (user.role === "LEADER" && user.facultyId) {
    conditions.push(eq(assignments.facultyId, user.facultyId));
  } else if (facultyId) {
    conditions.push(eq(assignments.facultyId, facultyId));
  }

  // Interns see only their own
  if (user.role === "INTERN") {
    conditions.push(eq(assignments.internId, user.id));
  }

  // Allow coordinator or leader to filter by specific intern
  if (internId && (user.role === "COORDINATOR" || user.role === "LEADER")) {
    conditions.push(eq(assignments.internId, internId));
  }

  // selfOnly=true: return only assignments where the user is the intern (any role)
  if (searchParams.get("selfOnly") === "true") {
    conditions.push(eq(assignments.internId, user.id));
  }

  // Preceptors must filter by base (declared base sent from client)
  if (user.role === "PRECEPTOR") {
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
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createAssignmentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  const { allowRetroactiveOverride, allowAdminOpenAllocation, shift: rawShift, ...assignmentData } = parsed.data;
  const shiftValue = rawShift ?? null;
  const allowCoordinatorRetroactiveOverride = user.role === "COORDINATOR"
    && allowRetroactiveOverride === true
    && assignmentData.date < localDateStr();
  const allowCoordinatorOpenAllocation = user.role === "COORDINATOR" && allowAdminOpenAllocation === true;

  // Leader can only create for their faculty
  if (user.role === "LEADER" && assignmentData.facultyId !== user.facultyId) {
    return NextResponse.json({ success: false, error: "Só pode alocar internos da sua faculdade" }, { status: 403 });
  }

  // For shift-aware duplicate check: match exact shift (or both null)
  const shiftCondition = shiftValue
    ? eq(assignments.shift, shiftValue)
    : sql`${assignments.shift} IS NULL`;

  const [existingAssignment] = await db
    .select({
      id: assignments.id,
      status: assignments.status,
      baseId: assignments.baseId,
      facultyId: assignments.facultyId,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.internId, assignmentData.internId),
        eq(assignments.date, assignmentData.date),
        eq(assignments.period, assignmentData.period),
        shiftCondition,
      ),
    )
    .limit(1);

  if (existingAssignment && existingAssignment.status !== "CANCELLED") {
    return NextResponse.json(
      { success: false, error: "Interno já possui plantão neste dia e turno" },
      { status: 409 },
    );
  }

  const isCancelledSameSlot = existingAssignment?.status === "CANCELLED"
    && existingAssignment.baseId === assignmentData.baseId
    && existingAssignment.facultyId === assignmentData.facultyId;

  if (!isCancelledSameSlot) {
    if (!allowCoordinatorOpenAllocation) {
      const slot = await checkSlotAvailability(
        assignmentData.baseId,
        assignmentData.date,
        assignmentData.period,
        assignmentData.facultyId,
        shiftValue,
      );
      if (!slot.available) {
        return NextResponse.json({ success: false, error: `Sem vaga (${slot.assigned}/${slot.capacity})` }, { status: 409 });
      }
    }

    if (!allowCoordinatorRetroactiveOverride) {
      const cruCheck = await checkCruConflict(assignmentData.internId, assignmentData.date, assignmentData.period);
      if (cruCheck.conflicted) {
        return NextResponse.json({ success: false, error: cruCheck.reason }, { status: 409 });
      }
    }
  }

  try {
    if (existingAssignment?.status === "CANCELLED") {
      const [reactivated] = await db
        .update(assignments)
        .set({
          facultyId: assignmentData.facultyId,
          baseId: assignmentData.baseId,
          shift: shiftValue,
          status: "SCHEDULED",
          notes: assignmentData.notes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(assignments.id, existingAssignment.id))
        .returning();

      await logAudit({
        userId: user.realUserId ?? user.id,
        action: "REACTIVATE_CANCELLED_ASSIGNMENT",
        entity: "assignment",
        entityId: existingAssignment.id,
        payload: {
          ...assignmentData,
          shift: shiftValue,
          allowRetroactiveOverride: allowCoordinatorRetroactiveOverride,
          allowAdminOpenAllocation: allowCoordinatorOpenAllocation,
          ...(user.isImpersonating ? { impersonating: user.id } : {}),
        },
      });

      return NextResponse.json({ success: true, data: reactivated, reusedCancelled: true });
    }

    const [created] = await db
      .insert(assignments)
      .values({ ...assignmentData, shift: shiftValue, createdBy: user.realUserId ?? user.id })
      .returning();

    await logAudit({
      userId: user.realUserId ?? user.id,
      action: "CREATE_ASSIGNMENT",
      entity: "assignment",
      entityId: created.id,
      payload: {
        ...assignmentData,
        allowRetroactiveOverride: allowCoordinatorRetroactiveOverride,
        allowAdminOpenAllocation: allowCoordinatorOpenAllocation,
        ...(user.isImpersonating ? { impersonating: user.id } : {}),
      },
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err: unknown) {
    const cause = typeof err === "object" && err !== null && "cause" in err ? (err as { cause?: { code?: string } }).cause : undefined;
    if (cause?.code === "23505") {
      return NextResponse.json(
        { success: false, error: "Interno já possui plantão neste dia e turno" },
        { status: 409 },
      );
    }

    const errorCode = typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: string }).code
      : undefined;

    console.error("POST /api/assignments failed", {
      errorCode,
      causeCode: cause?.code,
      userId: user.realUserId ?? user.id,
      role: user.role,
      payload: assignmentData,
      allowRetroactiveOverride: allowCoordinatorRetroactiveOverride,
      allowAdminOpenAllocation: allowCoordinatorOpenAllocation,
    });

    return NextResponse.json(
      { success: false, error: "Falha ao criar ou reativar plantão. Se o problema persistir, contate o suporte." },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const { id, status, notes } = body;
  if (!id) return NextResponse.json({ success: false, error: "ID obrigatório" }, { status: 400 });

  // Leader must own the assignment's faculty
  if (user.role === "LEADER" && user.facultyId) {
    const [target] = await db
      .select({ facultyId: assignments.facultyId })
      .from(assignments)
      .where(eq(assignments.id, id));
    if (!target || target.facultyId !== user.facultyId) {
      return NextResponse.json({ success: false, error: "Assignment não pertence à sua faculdade" }, { status: 403 });
    }
  }

  const [updated] = await db
    .update(assignments)
    .set({ status, notes, updatedAt: new Date() })
    .where(eq(assignments.id, id))
    .returning();

  if (!updated) return NextResponse.json({ success: false, error: "Assignment não encontrado" }, { status: 404 });

  await logAudit({ userId: user.realUserId ?? user.id, action: "UPDATE_ASSIGNMENT", entity: "assignment", entityId: id, payload: { status, notes, ...(user.isImpersonating ? { impersonating: user.id } : {}) } });
  return NextResponse.json({ success: true, data: updated });
}
