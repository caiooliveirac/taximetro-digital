import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { bases } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";

const baseSchema = z.object({
  code: z.string().min(2).max(10),
  name: z.string().min(2).max(100),
  type: z.enum(["USA", "CENTRAL"]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  geoFenceMeters: z.number().int().min(50).max(2000).default(200),
  isActive: z.boolean().default(true),
});

async function requireCoordinator(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || token.role !== "COORDINATOR") return null;
  return token;
}

export async function GET() {
  const rows = await db.select().from(bases).orderBy(bases.code);
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const body = await req.json();
  const parsed = baseSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const [created] = await db.insert(bases).values(parsed.data).returning();
  await logAudit({ userId: token.id as string, action: "CREATE_BASE", entity: "base", entityId: created.id, payload: parsed.data });
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const token = await requireCoordinator(req);
  if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const body = await req.json();
  const { id, ...rest } = body;
  if (!id) return NextResponse.json({ success: false, error: "ID obrigatório" }, { status: 400 });

  const parsed = baseSchema.partial().safeParse(rest);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const [updated] = await db.update(bases).set(parsed.data).where(eq(bases.id, id)).returning();
  if (!updated) return NextResponse.json({ success: false, error: "Base não encontrada" }, { status: 404 });

  await logAudit({ userId: token.id as string, action: "UPDATE_BASE", entity: "base", entityId: id, payload: parsed.data });
  return NextResponse.json({ success: true, data: updated });
}
