import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assignments, bases, userRoles, faculties } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { checkCruConflict } from "@/lib/slots";
import { getEffectiveUser } from "@/lib/impersonate";
import { operationalDateStr } from "@/lib/utils";
import { z } from "zod/v4";

const selfCreateSchema = z.object({
  baseId: z.string().uuid(),
  period: z.enum(["DAY", "NIGHT"]),
});

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || (user.role !== "INTERN" && user.role !== "LEADER")) {
    return NextResponse.json({ success: false, error: "Apenas internos e líderes podem criar plantão avulso" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = selfCreateSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const { baseId, period } = parsed.data;
  const internId = user.id;
  const today = operationalDateStr();

  // Validate base exists and is active
  const [base] = await db
    .select()
    .from(bases)
    .where(and(eq(bases.id, baseId), eq(bases.isActive, true)))
    .limit(1);
  if (!base)
    return NextResponse.json({ success: false, error: "Base não encontrada" }, { status: 404 });

  // Get intern's faculty
  const [role] = await db
    .select({ facultyId: userRoles.facultyId })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, internId),
        inArray(userRoles.role, ["INTERN", "LEADER"]),
        eq(userRoles.isActive, true),
      ),
    )
    .limit(1);
  if (!role?.facultyId)
    return NextResponse.json({ success: false, error: "Faculdade não encontrada" }, { status: 400 });

  // Check: intern must NOT already have an assignment for today+period
  const [existing] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.internId, internId),
        eq(assignments.date, today),
        eq(assignments.period, period),
      ),
    )
    .limit(1);
  if (existing)
    return NextResponse.json({ success: false, error: "Você já tem um plantão neste turno hoje" }, { status: 409 });

  // Check CRU ±12h conflict
  const cruCheck = await checkCruConflict(internId, today, period);
  if (cruCheck.conflicted) {
    return NextResponse.json({ success: false, error: cruCheck.reason }, { status: 409 });
  }

  // Create self-assignment with marker in notes
  const [created] = await db
    .insert(assignments)
    .values({
      internId,
      facultyId: role.facultyId,
      baseId,
      date: today,
      period,
      status: "SCHEDULED",
      createdBy: internId,
      notes: "[AUTO_CRIADO]",
    })
    .returning();

  // Fetch faculty abbreviation for the audit payload
  const [fac] = await db
    .select({ abbreviation: faculties.abbreviation })
    .from(faculties)
    .where(eq(faculties.id, role.facultyId))
    .limit(1);

  await logAudit({
    userId: user.realUserId ?? user.id,
    action: "SELF_CREATE_ASSIGNMENT",
    entity: "assignment",
    entityId: created.id,
    payload: {
      baseCode: base.code,
      baseName: base.name,
      period,
      faculty: fac?.abbreviation ?? "",
      ...(user.isImpersonating ? { impersonating: user.id } : {}),
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      id: created.id,
      baseId: base.id,
      baseCode: base.code,
      baseName: base.name,
      baseLatitude: base.latitude,
      baseLongitude: base.longitude,
      period,
      status: "SCHEDULED",
    },
  }, { status: 201 });
}
