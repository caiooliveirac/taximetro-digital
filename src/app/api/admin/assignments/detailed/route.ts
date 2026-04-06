import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || token.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json({ success: false, error: "Parâmetros from e to são obrigatórios" }, { status: 400 });
  }

  const rows = await db.execute(sql`
    SELECT
      a.id,
      a.intern_id,
      u.name AS intern_name,
      a.faculty_id,
      f.abbreviation AS faculty_abbr,
      a.base_id,
      b.code AS base_code,
      b.name AS base_name,
      b.type AS base_type,
      a.date::text AS date,
      a.period,
      a.shift,
      a.status,
      a.notes,
      c.geo_valid,
      c.status AS checkin_status,
      c.method AS checkin_method,
      c.checkin_at,
      c.totp_validated_at,
      vu.name AS validated_by_name,
      c.checkout_at,
      cu.name AS checkout_confirmed_by_name,
      c.intern_observations,
      c.preceptor_observations,
      c.checkout_notes
    FROM assignments a
    JOIN users u ON u.id = a.intern_id
    JOIN faculties f ON f.id = a.faculty_id
    JOIN bases b ON b.id = a.base_id
    LEFT JOIN checkins c ON c.assignment_id = a.id
    LEFT JOIN users vu ON vu.id = c.validated_by
    LEFT JOIN users cu ON cu.id = c.checkout_confirmed_by
    WHERE a.date >= ${from}
      AND a.date <= ${to}
      AND a.status != 'CANCELLED'
    ORDER BY a.date, b.code, a.period, u.name
  `);

  return NextResponse.json({ success: true, data: rows });
}