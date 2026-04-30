import { sql } from "drizzle-orm";
import { db } from "@/shared/db/client";

export async function listDetailedAssignmentsByDateRange(params: { from: string; to: string }) {
  return db.execute(sql`
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
      a.is_extra_shift,
      a.extra_shift_notes,
      a.notes,
      c.geo_valid,
      c.status AS checkin_status,
      c.method AS checkin_method,
      c.checkin_at,
      c.totp_validated_at,
      COALESCE(vu.name, c.validated_by_name) AS validated_by_name,
      c.checkout_at,
      COALESCE(cu.name, c.checkout_confirmed_by_name) AS checkout_confirmed_by_name,
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
    WHERE a.date >= ${params.from}
      AND a.date <= ${params.to}
      AND a.status != 'CANCELLED'
    ORDER BY a.date, b.code, a.period, u.name
  `);
}

export async function getDetailedAssignmentById(params: { id: string }) {
  return db.execute(sql`
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
      a.is_extra_shift,
      a.extra_shift_notes,
      a.notes,
      c.geo_valid,
      c.status AS checkin_status,
      c.method AS checkin_method,
      c.checkin_at,
      c.totp_validated_at,
      COALESCE(vu.name, c.validated_by_name) AS validated_by_name,
      c.checkout_at,
      COALESCE(cu.name, c.checkout_confirmed_by_name) AS checkout_confirmed_by_name,
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
    WHERE a.id = ${params.id}
    LIMIT 1
  `);
}
