import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { caseRecords, assignments } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod/v4";

const createSchema = z.object({
  assignmentId: z.string().uuid(),
  nickname: z.string().min(1).max(100),
  description: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const rows = await db.select().from(caseRecords).orderBy(caseRecords.createdAt);

  const filtered = token.role === "INTERN"
    ? rows.filter((r) => r.internId === token.id)
    : rows;

  return NextResponse.json({ success: true, data: filtered });
}

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  // Auto-generate case number
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(caseRecords)
    .where(eq(caseRecords.assignmentId, parsed.data.assignmentId));

  const caseNumber = String((countResult?.count ?? 0) + 1).padStart(4, "0");

  const [created] = await db.insert(caseRecords).values({
    assignmentId: parsed.data.assignmentId,
    internId: token.id as string,
    caseNumber,
    nickname: parsed.data.nickname,
    description: parsed.data.description ?? null,
  }).returning();

  return NextResponse.json({ success: true, data: created }, { status: 201 });
}
