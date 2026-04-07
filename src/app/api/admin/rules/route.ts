import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { slotRules, bases, faculties, assignments } from "@/db/schema";
import { eq, and, ne, gte, inArray } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";
import { localDateStr } from "@/lib/utils";

const ruleSchema = z.object({
  baseId: z.string().uuid(),
  dayOfWeek: z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]),
  period: z.enum(["DAY", "NIGHT"]),
  facultyId: z.string().uuid(),
  capacity: z.number().int().min(0).max(20).default(1),
  isActive: z.boolean().default(true),
  isBlocked: z.boolean().default(false),
  blockedReason: z.string().max(100).nullable().optional(),
});

async function requireCoordinator(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || token.role !== "COORDINATOR") return null;
  return token;
}

export async function GET() {
  const rows = await db
    .select({
      id: slotRules.id,
      baseId: slotRules.baseId,
      baseCode: bases.code,
      baseName: bases.name,
      dayOfWeek: slotRules.dayOfWeek,
      period: slotRules.period,
      facultyId: slotRules.facultyId,
      facultyAbbr: faculties.abbreviation,
      capacity: slotRules.capacity,
      isActive: slotRules.isActive,
      isBlocked: slotRules.isBlocked,
      blockedReason: slotRules.blockedReason,
      blockedBy: slotRules.blockedBy,
      blockedAt: slotRules.blockedAt,
    })
    .from(slotRules)
    .innerJoin(bases, eq(bases.id, slotRules.baseId))
    .innerJoin(faculties, eq(faculties.id, slotRules.facultyId))
    .orderBy(bases.code, slotRules.dayOfWeek, slotRules.period);

  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const body = await req.json();
  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const data = parsed.data;

  // If creating a blocked rule, set blocked metadata
  if (data.isBlocked) {
    const [created] = await db.insert(slotRules).values({
      ...data,
      blockedReason: data.blockedReason ?? null,
      blockedBy: token.id as string,
      blockedAt: new Date(),
    }).returning();
    await logAudit({ userId: token.id as string, action: "SLOT_BLOCKED", entity: "slot_rule", entityId: created.id, payload: { ...data, blockedBy: token.id } });
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  }

  const [created] = await db.insert(slotRules).values(data).returning();
  await logAudit({ userId: token.id as string, action: "CREATE_SLOT_RULE", entity: "slot_rule", entityId: created.id, payload: data });
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const body = await req.json();
  const { id, ...rest } = body;
  if (!id) return NextResponse.json({ success: false, error: "ID obrigatório" }, { status: 400 });

  const parsed = ruleSchema.partial().safeParse(rest);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const data = parsed.data;

  // If toggling to blocked, check for future assignments
  if (data.isBlocked === true) {
    const [existingRule] = await db.select().from(slotRules).where(eq(slotRules.id, id)).limit(1);
    if (existingRule) {
      const today = localDateStr();
      const futureAssignments = await db
        .select({ id: assignments.id, date: assignments.date })
        .from(assignments)
        .where(and(
          eq(assignments.baseId, existingRule.baseId),
          eq(assignments.period, existingRule.period),
          eq(assignments.facultyId, existingRule.facultyId),
          gte(assignments.date, today),
          inArray(assignments.status, ["SCHEDULED", "CONFIRMED"]),
        ))
        .limit(5);
      if (futureAssignments.length > 0) {
        return NextResponse.json({
          success: false,
          error: `Existem ${futureAssignments.length} plantão(ões) futuro(s) neste slot. Cancele-os antes de bloquear.`,
          futureAssignments,
        }, { status: 409 });
      }
    }
    (data as Record<string, unknown>).blockedBy = token.id as string;
    (data as Record<string, unknown>).blockedAt = new Date();
  }

  // If unblocking, clear blocked metadata
  if (data.isBlocked === false) {
    (data as Record<string, unknown>).blockedReason = null;
    (data as Record<string, unknown>).blockedBy = null;
    (data as Record<string, unknown>).blockedAt = null;
  }

  const [updated] = await db.update(slotRules).set(data).where(eq(slotRules.id, id)).returning();
  if (!updated) return NextResponse.json({ success: false, error: "Regra não encontrada" }, { status: 404 });

  const auditAction = data.isBlocked === true ? "SLOT_BLOCKED" : data.isBlocked === false ? "SLOT_UNBLOCKED" : "UPDATE_SLOT_RULE";
  await logAudit({ userId: token.id as string, action: auditAction, entity: "slot_rule", entityId: id, payload: data });
  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: "ID obrigatório" }, { status: 400 });

  const [deleted] = await db.update(slotRules).set({ isActive: false }).where(eq(slotRules.id, id)).returning();
  if (!deleted) return NextResponse.json({ success: false, error: "Regra não encontrada" }, { status: 404 });

  await logAudit({ userId: token.id as string, action: "DELETE_SLOT_RULE", entity: "slot_rule", entityId: id });
  return NextResponse.json({ success: true });
}
