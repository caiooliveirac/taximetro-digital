import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { faculties } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";

const facultySchema = z.object({
  name: z.string().min(2).max(100),
  abbreviation: z.string().min(2).max(10),
  targetHours: z.number().int().min(0).default(0),
  targetShifts: z.number().int().min(0).default(0),
  targetShiftsPerWeek: z.number().int().min(0).default(0),
  totalInterns: z.number().int().min(0).default(0),
});

async function requireCoordinator(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || token.role !== "COORDINATOR") return null;
  return token;
}

export async function GET() {
  const rows = await db.select().from(faculties).orderBy(faculties.abbreviation);
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const body = await req.json();
  const parsed = facultySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const [created] = await db.insert(faculties).values(parsed.data).returning();
  await logAudit({ userId: token.id as string, action: "CREATE_FACULTY", entity: "faculty", entityId: created.id, payload: parsed.data });
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const body = await req.json();
  const { id, ...rest } = body;
  if (!id) return NextResponse.json({ success: false, error: "ID obrigatório" }, { status: 400 });

  const parsed = facultySchema.partial().safeParse(rest);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const [updated] = await db.update(faculties).set(parsed.data).where(eq(faculties.id, id)).returning();
  if (!updated) return NextResponse.json({ success: false, error: "Faculdade não encontrada" }, { status: 404 });

  await logAudit({ userId: token.id as string, action: "UPDATE_FACULTY", entity: "faculty", entityId: id, payload: parsed.data });
  return NextResponse.json({ success: true, data: updated });
}
