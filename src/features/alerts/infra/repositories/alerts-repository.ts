import { sql } from "drizzle-orm";
import { db } from "@/shared/db/client";

export async function listRecentAlerts(params: {
  today: string;
  facultyId?: string;
}) {
  const facultyFilter = params.facultyId
    ? sql`AND a.faculty_id = ${params.facultyId}`
    : sql``;

  return db.execute(sql`
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
    WHERE a.status = 'ABSENT' AND a.date >= ${params.today}::date - INTERVAL '7 days' ${facultyFilter}

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
    WHERE c.geo_valid = false AND c.created_at >= ${params.today}::date - INTERVAL '7 days' ${facultyFilter}

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
    WHERE c.status = 'EXPIRED' AND c.created_at >= ${params.today}::date - INTERVAL '7 days' ${facultyFilter}

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
    WHERE a.notes = '[AUTO_CRIADO]' AND a.date >= ${params.today}::date - INTERVAL '7 days' ${facultyFilter}

    UNION ALL

    SELECT
      'REASSIGNMENT' AS type,
      a.id AS entity_id,
      u.name AS intern_name,
      f.abbreviation AS faculty,
      b.code AS base_code,
      a.period,
      a.date::text AS date,
      a.notes AS detail
    FROM assignments a
    JOIN users u ON u.id = a.intern_id
    JOIN faculties f ON f.id = a.faculty_id
    JOIN bases b ON b.id = a.base_id
    WHERE a.notes LIKE '%[REMANEJADO]%' AND a.date >= ${params.today}::date - INTERVAL '7 days' ${facultyFilter}

    ORDER BY date DESC
  `);
}
