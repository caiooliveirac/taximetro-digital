import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || !["COORDINATOR", "LEADER"].includes(token.role as string)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const { id } = await params;

  // All assignments with checkin info
  const assignments = await db.execute(sql`
    SELECT
      a.id,
      a.date,
      a.period,
      a.status AS assignment_status,
      b.code AS base_code,
      b.name AS base_name,
      c.status AS checkin_status,
      c.geo_valid,
      c.method AS checkin_method,
      c.checkin_at,
      c.checkout_at
    FROM assignments a
    JOIN bases b ON b.id = a.base_id
    LEFT JOIN checkins c ON c.assignment_id = a.id
    WHERE a.intern_id = ${id}
    ORDER BY a.date DESC, a.period
  `);

  // All requests made by this user
  const requests = await db.execute(sql`
    SELECT
      r.id,
      r.type,
      r.status,
      r.created_at,
      r.review_notes,
      a.date AS assignment_date,
      b.code AS base_code,
      eb.code AS extra_base_code,
      r.extra_date,
      r.extra_period
    FROM requests r
    LEFT JOIN assignments a ON a.id = r.assignment_id
    LEFT JOIN bases b ON b.id = a.base_id
    LEFT JOIN bases eb ON eb.id = r.extra_base_id
    WHERE r.requester_id = ${id}
    ORDER BY r.created_at DESC
  `);

  return NextResponse.json({ success: true, data: { assignments, requests } });
}
