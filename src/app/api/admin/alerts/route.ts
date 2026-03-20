import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token || !["COORDINATOR", "LEADER"].includes(token.role as string))
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const today = new Date().toISOString().split("T")[0]!;

  const rows = await db.execute(sql`
    SELECT
      'ABSENCE' AS type,
      a.id AS entity_id,
      u.name AS intern_name,
      f.abbreviation AS faculty,
      b.code AS base_code,
      a.period,
      a.date::text AS date,
      NULL AS detail
    FROM assignments a
    JOIN users u ON u.id = a.intern_id
    JOIN faculties f ON f.id = a.faculty_id
    JOIN bases b ON b.id = a.base_id
    WHERE a.status = 'ABSENT' AND a.date >= ${today}::date - INTERVAL '7 days'

    UNION ALL

    SELECT
      'GEO_VIOLATION' AS type,
      c.id AS entity_id,
      u.name AS intern_name,
      f.abbreviation AS faculty,
      b.code AS base_code,
      a.period,
      a.date::text AS date,
      ROUND(c.geo_distance_meters::numeric, 0)::text || 'm' AS detail
    FROM checkins c
    JOIN assignments a ON a.id = c.assignment_id
    JOIN users u ON u.id = c.intern_id
    JOIN faculties f ON f.id = a.faculty_id
    JOIN bases b ON b.id = a.base_id
    WHERE c.geo_valid = false AND c.created_at >= ${today}::date - INTERVAL '7 days'

    UNION ALL

    SELECT
      'TOTP_EXPIRED' AS type,
      c.id AS entity_id,
      u.name AS intern_name,
      f.abbreviation AS faculty,
      b.code AS base_code,
      a.period,
      a.date::text AS date,
      NULL AS detail
    FROM checkins c
    JOIN assignments a ON a.id = c.assignment_id
    JOIN users u ON u.id = c.intern_id
    JOIN faculties f ON f.id = a.faculty_id
    JOIN bases b ON b.id = a.base_id
    WHERE c.status = 'EXPIRED' AND c.created_at >= ${today}::date - INTERVAL '7 days'

    UNION ALL

    SELECT
      'SELF_ASSIGNMENT' AS type,
      a.id AS entity_id,
      u.name AS intern_name,
      f.abbreviation AS faculty,
      b.code AS base_code,
      a.period,
      a.date::text AS date,
      NULL AS detail
    FROM assignments a
    JOIN users u ON u.id = a.intern_id
    JOIN faculties f ON f.id = a.faculty_id
    JOIN bases b ON b.id = a.base_id
    WHERE a.notes = '[AUTO_CRIADO]' AND a.date >= ${today}::date - INTERVAL '7 days'

    ORDER BY date DESC
  `);

  return NextResponse.json({ success: true, data: rows });
}
