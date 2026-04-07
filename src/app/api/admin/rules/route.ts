import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { slotRules, bases, faculties } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";

const ruleSchema = z.object({
  baseId: z.string().uuid(),
  dayOfWeek: z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]),
  period: z.enum(["DAY", "NIGHT"]),
  facultyId: z.string().uuid(),
  capacity: z.number().int().min(0).max(20).default(1),
  isActive: z.boolean().default(true),
  isExtraShift: z.boolean().default(false),
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
      isExtraShift: slotRules.isExtraShift,
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

  const [updated] = await db.update(slotRules).set(data).where(eq(slotRules.id, id)).returning();
  if (!updated) return NextResponse.json({ success: false, error: "Regra não encontrada" }, { status: 404 });

  await logAudit({ userId: token.id as string, action: "UPDATE_SLOT_RULE", entity: "slot_rule", entityId: id, payload: data });
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
