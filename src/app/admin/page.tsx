import { db } from "@/db";
import { sql } from "drizzle-orm";
import { AdminDashboardClient, type DashboardData } from "@/components/admin-dashboard";
import { baseViewIndex } from "@/lib/base-colors";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const today = new Date().toISOString().split("T")[0]!;

  const [stats] = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE is_active = true) AS total_users,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status != 'CANCELLED') AS today_assignments,
      (SELECT COUNT(*)::int FROM checkins c JOIN assignments a ON a.id = c.assignment_id WHERE a.date = ${today} AND c.status = 'VALIDATED') AS today_checkins,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status = 'ABSENT') AS today_absences,
      (SELECT COUNT(*)::int FROM checkins WHERE geo_valid = false AND created_at >= CURRENT_DATE) AS geo_violations,
      (SELECT COUNT(*)::int FROM checkins WHERE status = 'EXPIRED' AND created_at >= CURRENT_DATE) AS totp_expired,
      (SELECT COUNT(*)::int FROM assignments WHERE notes = '[AUTO_CRIADO]' AND date = ${today}) AS self_assignments,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status = 'CHECKED_IN') AS active_checkins,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status = 'CHECKED_OUT') AS completed,
      (SELECT COUNT(*)::int FROM assignments WHERE date >= CURRENT_DATE - 6 AND date <= CURRENT_DATE AND status IN ('CHECKED_IN', 'CHECKED_OUT', 'ABSENT')) AS week_scheduled,
      (SELECT COUNT(*)::int FROM assignments WHERE date >= CURRENT_DATE - 6 AND date <= CURRENT_DATE AND status IN ('CHECKED_IN', 'CHECKED_OUT')) AS week_present,
      (SELECT COUNT(*)::int FROM bases WHERE is_active = true) AS base_count,
      (SELECT COUNT(*)::int FROM faculties) AS faculty_count
  `);

  const s = stats as Record<string, number>;
  const checkinRate = (s["today_assignments"] ?? 0) > 0
    ? Math.round(((s["today_checkins"] ?? 0) / (s["today_assignments"] ?? 1)) * 100)
    : 0;
  const weekRate = (s["week_scheduled"] ?? 0) > 0
    ? Math.round(((s["week_present"] ?? 0) / (s["week_scheduled"] ?? 1)) * 100)
    : 0;

  const facultyRows = await db.execute(sql`
    SELECT
      f.abbreviation,
      COUNT(a.id)::int AS total,
      COUNT(CASE WHEN a.status IN ('CHECKED_IN', 'CHECKED_OUT') THEN 1 END)::int AS present,
      COUNT(CASE WHEN a.status = 'ABSENT' THEN 1 END)::int AS absent,
      COUNT(CASE WHEN a.status = 'SCHEDULED' THEN 1 END)::int AS pending
    FROM assignments a
    JOIN faculties f ON f.id = a.faculty_id
    WHERE a.date = ${today} AND a.status != 'CANCELLED'
    GROUP BY f.abbreviation
    ORDER BY f.abbreviation
  `);

  const baseRows = await db.execute(sql`
    SELECT
      b.code, b.name,
      COUNT(a.id)::int AS total,
      COUNT(CASE WHEN a.status IN ('CHECKED_IN', 'CHECKED_OUT') THEN 1 END)::int AS present,
      COUNT(CASE WHEN a.status = 'ABSENT' THEN 1 END)::int AS absent
    FROM assignments a
    JOIN bases b ON b.id = a.base_id
    WHERE a.date = ${today} AND a.status != 'CANCELLED'
    GROUP BY b.code, b.name
    ORDER BY b.code
  `);

  // Per-base detail for clickable cards
  const baseDetailRows = await db.execute(sql`
    SELECT b.code AS base_code, b.name AS base_name,
           u.name AS intern_name, f.abbreviation AS faculty,
           a.period, a.status,
           c.checkin_at, c.totp_validated_at,
           vu.name AS validated_by_name
    FROM assignments a
    JOIN users u ON u.id = a.intern_id
    JOIN bases b ON b.id = a.base_id
    JOIN faculties f ON f.id = a.faculty_id
    LEFT JOIN checkins c ON c.assignment_id = a.id
    LEFT JOIN users vu ON vu.id = c.validated_by
    WHERE a.date = ${today} AND a.status != 'CANCELLED'
    ORDER BY b.code, a.period, u.name
  `);

  // Week per-day breakdown (last 7 days, resolved only)
  const weekDayRows = await db.execute(sql`
    SELECT
      a.date::text AS date,
      COUNT(*)::int AS total,
      COUNT(CASE WHEN a.status IN ('CHECKED_IN', 'CHECKED_OUT') THEN 1 END)::int AS present,
      COUNT(CASE WHEN a.status = 'ABSENT' THEN 1 END)::int AS absent
    FROM assignments a
    WHERE a.date >= CURRENT_DATE - 6
      AND a.date <= CURRENT_DATE
      AND a.status IN ('CHECKED_IN', 'CHECKED_OUT', 'ABSENT')
    GROUP BY a.date ORDER BY a.date
  `);

  // Detail data for clickable KPIs
  const [absenceRows, geoRows, totpRows, activeRows, assignmentRows, checkedInRows, completedDetailRows, selfAssignmentRows] = await Promise.all([
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, a.period
      FROM assignments a JOIN users u ON u.id = a.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date = ${today} AND a.status = 'ABSENT'
      ORDER BY u.name
    `),
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, ROUND(c.geo_distance_meters::numeric, 0)::text AS distance
      FROM checkins c JOIN assignments a ON a.id = c.assignment_id JOIN users u ON u.id = c.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE c.geo_valid = false AND c.created_at >= CURRENT_DATE
      ORDER BY c.geo_distance_meters DESC
    `),
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, a.period
      FROM checkins c JOIN assignments a ON a.id = c.assignment_id JOIN users u ON u.id = c.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE c.status = 'EXPIRED' AND c.created_at >= CURRENT_DATE
      ORDER BY u.name
    `),
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, a.period
      FROM assignments a JOIN users u ON u.id = a.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date = ${today} AND a.status = 'CHECKED_IN'
      ORDER BY u.name
    `),
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, a.period, a.status
      FROM assignments a JOIN users u ON u.id = a.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date = ${today} AND a.status != 'CANCELLED'
      ORDER BY b.code, a.period, u.name
    `),
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, a.period
      FROM checkins c JOIN assignments a ON a.id = c.assignment_id JOIN users u ON u.id = c.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date = ${today} AND c.status = 'VALIDATED'
      ORDER BY u.name
    `),
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, a.period
      FROM assignments a JOIN users u ON u.id = a.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date = ${today} AND a.status = 'CHECKED_OUT'
      ORDER BY b.code, a.period, u.name
    `),
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, a.period
      FROM assignments a JOIN users u ON u.id = a.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.notes = '[AUTO_CRIADO]' AND a.date = ${today}
      ORDER BY u.name
    `),
  ]);

  const PERIOD_LABEL: Record<string, string> = { DAY: "Diurno", NIGHT: "Noturno" };
  const STATUS_LABEL: Record<string, string> = { SCHEDULED: "Escalado", CONFIRMED: "Confirmado", CHECKED_IN: "Presente", CHECKED_OUT: "Finalizado", ABSENT: "Ausente", CANCELLED: "Cancelado" };

  const toDetail = (row: Record<string, unknown>) => ({
    name: String(row.name ?? ""),
    faculty: String(row.faculty ?? ""),
    extra: `${row.base_code ?? ""} — ${PERIOD_LABEL[String(row.period ?? "")] ?? ""}`,
  });

  // Merge geo + totp into incidents
  const incidents = [
    ...(geoRows as Record<string, unknown>[]).map((r) => ({
      name: String(r.name ?? ""),
      faculty: String(r.faculty ?? ""),
      extra: `${r.base_code} — Fora do georreferenciamento (${r.distance}m)`,
    })),
    ...(totpRows as Record<string, unknown>[]).map((r) => ({
      name: String(r.name ?? ""),
      faculty: String(r.faculty ?? ""),
      extra: `${r.base_code} — Sem validação (TOTP expirado)`,
    })),
  ];

  // Sort todayAssignments by canonical base order
  const sortedAssignments = (assignmentRows as Record<string, unknown>[])
    .slice()
    .sort((a, b) => baseViewIndex(String(a.base_code)) - baseViewIndex(String(b.base_code)));

  // Build per-base detail map
  const baseDetailsMap: Record<string, DashboardData["baseDetails"][string]> = {};
  for (const r of baseDetailRows as Record<string, unknown>[]) {
    const code = String(r.base_code);
    if (!baseDetailsMap[code]) baseDetailsMap[code] = [];
    baseDetailsMap[code].push({
      internName: String(r.intern_name ?? ""),
      faculty: String(r.faculty ?? ""),
      period: String(r.period ?? ""),
      status: String(r.status ?? ""),
      checkinAt: r.checkin_at ? String(r.checkin_at) : null,
      validatedBy: r.validated_by_name ? String(r.validated_by_name) : null,
    });
  }

  // Sort bases by view order
  const sortedBases = (baseRows as unknown as DashboardData["bases"])
    .slice()
    .sort((a, b) => baseViewIndex(a.code) - baseViewIndex(b.code));

  const data: DashboardData = {
    s,
    checkinRate,
    weekRate,
    weekDays: weekDayRows as unknown as DashboardData["weekDays"],
    faculties: facultyRows as unknown as DashboardData["faculties"],
    bases: sortedBases,
    baseDetails: baseDetailsMap,
    dateLabel: new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }),
    details: {
      absences: (absenceRows as Record<string, unknown>[]).map(toDetail),
      incidents,
      activeCheckins: (activeRows as Record<string, unknown>[]).map(toDetail),
      todayAssignments: sortedAssignments.map((r) => ({
        name: String(r.name ?? ""),
        faculty: String(r.faculty ?? ""),
        extra: `${r.base_code} — ${PERIOD_LABEL[String(r.period ?? "")] ?? ""} (${STATUS_LABEL[String(r.status)] ?? r.status})`,
      })),
      checkedIn: (checkedInRows as Record<string, unknown>[]).map(toDetail),
      todayCompleted: (completedDetailRows as Record<string, unknown>[]).map(toDetail),
      selfAssignments: (selfAssignmentRows as Record<string, unknown>[]).map(toDetail),
    },
  };

  return <AdminDashboardClient data={data} />;
}
