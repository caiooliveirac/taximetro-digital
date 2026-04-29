import { db } from "@/db";
import { sql } from "drizzle-orm";
import { addDaysToDateStr, isWithinAdminAttendanceWindow } from "@/lib/utils";
import { baseViewIndex } from "@/lib/base-colors";
import type { DashboardData } from "@/components/admin-dashboard";

export async function fetchDashboardData(
  today: string,
  calendarToday: string,
  currentPeriod: "DAY" | "NIGHT",
): Promise<DashboardData> {
  const previousCalendarDay = addDaysToDateStr(calendarToday, -1);
  const weekStart = addDaysToDateStr(today, -6);

  const [stats] = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE is_active = true) AS total_users,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status != 'CANCELLED' AND is_extra_shift = false) AS today_assignments,
      (SELECT COUNT(*)::int FROM checkins c JOIN assignments a ON a.id = c.assignment_id WHERE a.date = ${today} AND c.status = 'VALIDATED' AND a.is_extra_shift = false) AS today_checkins,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status = 'ABSENT' AND is_extra_shift = false) AS today_absences,
      (SELECT COUNT(*)::int FROM checkins c JOIN assignments a ON a.id = c.assignment_id WHERE a.date = ${today} AND c.geo_valid = false AND a.is_extra_shift = false) AS geo_violations,
      (SELECT COUNT(*)::int FROM checkins c JOIN assignments a ON a.id = c.assignment_id WHERE a.date = ${today} AND c.status = 'EXPIRED' AND a.is_extra_shift = false) AS totp_expired,
      (SELECT COUNT(*)::int FROM assignments WHERE notes = '[AUTO_CRIADO]' AND date = ${today} AND is_extra_shift = false) AS self_assignments,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status = 'CHECKED_IN' AND is_extra_shift = false) AS active_checkins,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status = 'CHECKED_OUT' AND is_extra_shift = false) AS completed,
      (SELECT COUNT(*)::int FROM bases WHERE is_active = true) AS base_count,
      (SELECT COUNT(*)::int FROM faculties) AS faculty_count,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status != 'CANCELLED' AND period = 'DAY' AND is_extra_shift = false) AS today_day_total,
      (SELECT COUNT(*)::int FROM checkins c JOIN assignments a ON a.id = c.assignment_id WHERE a.date = ${today} AND c.status = 'VALIDATED' AND a.period = 'DAY' AND a.is_extra_shift = false) AS today_day_checkins,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status != 'CANCELLED' AND period = 'NIGHT' AND is_extra_shift = false) AS today_night_total,
      (SELECT COUNT(*)::int FROM checkins c JOIN assignments a ON a.id = c.assignment_id WHERE a.date = ${today} AND c.status = 'VALIDATED' AND a.period = 'NIGHT' AND a.is_extra_shift = false) AS today_night_checkins
  `);

  const s = stats as Record<string, number>;

  const [facultyRows, baseRows, baseDetailRows, weekDayRows] = await Promise.all([
    db.execute(sql`
      SELECT
        f.abbreviation,
        COUNT(a.id)::int AS total,
        COUNT(CASE WHEN a.status IN ('CHECKED_IN', 'CHECKED_OUT') THEN 1 END)::int AS present,
        COUNT(CASE WHEN a.status = 'ABSENT' THEN 1 END)::int AS absent,
        COUNT(CASE WHEN a.status = 'SCHEDULED' THEN 1 END)::int AS pending
      FROM assignments a
      JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date = ${today} AND a.status != 'CANCELLED' AND a.is_extra_shift = false
      GROUP BY f.abbreviation
      ORDER BY f.abbreviation
    `),
    db.execute(sql`
      SELECT
        b.code, b.name,
        COUNT(a.id)::int AS total,
        COUNT(CASE WHEN a.status IN ('CHECKED_IN', 'CHECKED_OUT') THEN 1 END)::int AS present,
        COUNT(CASE WHEN a.status = 'ABSENT' THEN 1 END)::int AS absent
      FROM assignments a
      JOIN bases b ON b.id = a.base_id
      WHERE a.date = ${today} AND a.status != 'CANCELLED' AND a.is_extra_shift = false
      GROUP BY b.code, b.name
      ORDER BY b.code
    `),
    db.execute(sql`
      SELECT b.code AS base_code, b.name AS base_name,
             u.name AS intern_name, f.abbreviation AS faculty,
             a.period, a.status, a.notes,
             c.checkin_at, c.totp_validated_at,
             vu.name AS validated_by_name
      FROM assignments a
      JOIN users u ON u.id = a.intern_id
      JOIN bases b ON b.id = a.base_id
      JOIN faculties f ON f.id = a.faculty_id
      LEFT JOIN checkins c ON c.assignment_id = a.id
      LEFT JOIN users vu ON vu.id = c.validated_by
      WHERE a.date = ${today} AND a.status != 'CANCELLED' AND a.is_extra_shift = false
      ORDER BY b.code, a.period, u.name
    `),
    db.execute(sql`
      SELECT
        a.date::text AS date,
        COUNT(*)::int AS total,
        COUNT(CASE WHEN a.status IN ('CHECKED_IN', 'CHECKED_OUT') THEN 1 END)::int AS present,
        COUNT(CASE WHEN a.status = 'ABSENT' THEN 1 END)::int AS absent
      FROM assignments a
      WHERE a.date >= ${weekStart}
        AND a.date <= ${today}
        AND a.status != 'CANCELLED'
        AND a.is_extra_shift = false
      GROUP BY a.date ORDER BY a.date
    `),
  ]);

  const [absenceRows, geoRows, totpRows, activeRows, assignmentRows, checkedInRows, completedDetailRows, selfAssignmentRows] = await Promise.all([
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, a.period
      FROM assignments a JOIN users u ON u.id = a.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date = ${today} AND a.status = 'ABSENT' AND a.is_extra_shift = false
      ORDER BY u.name
    `),
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, ROUND(c.geo_distance_meters::numeric, 0)::text AS distance
      FROM checkins c JOIN assignments a ON a.id = c.assignment_id JOIN users u ON u.id = c.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date = ${today} AND c.geo_valid = false
      ORDER BY c.geo_distance_meters DESC
    `),
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, a.period
      FROM checkins c JOIN assignments a ON a.id = c.assignment_id JOIN users u ON u.id = c.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date = ${today} AND c.status = 'EXPIRED'
      ORDER BY u.name
    `),
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, a.period, a.date
      FROM assignments a JOIN users u ON u.id = a.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date >= ${previousCalendarDay} AND a.date <= ${today} AND a.status = 'CHECKED_IN' AND a.is_extra_shift = false
      ORDER BY a.date, u.name
    `),
    db.execute(sql`
      SELECT a.id, u.name, f.abbreviation AS faculty, b.code AS base_code, a.period, a.status, a.date, a.notes
      FROM assignments a JOIN users u ON u.id = a.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date >= ${previousCalendarDay} AND a.date <= ${today} AND a.status != 'CANCELLED' AND a.is_extra_shift = false
      ORDER BY a.date, b.code, a.period, u.name
    `),
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, a.period
      FROM checkins c JOIN assignments a ON a.id = c.assignment_id JOIN users u ON u.id = c.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date = ${today} AND c.status = 'VALIDATED' AND a.is_extra_shift = false
      ORDER BY u.name
    `),
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, a.period
      FROM assignments a JOIN users u ON u.id = a.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date = ${today} AND a.status = 'CHECKED_OUT' AND a.is_extra_shift = false
      ORDER BY b.code, a.period, u.name
    `),
    db.execute(sql`
      SELECT u.name, f.abbreviation AS faculty, b.code AS base_code, a.period
      FROM assignments a JOIN users u ON u.id = a.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.notes = '[AUTO_CRIADO]' AND a.date = ${today} AND a.is_extra_shift = false
      ORDER BY u.name
    `),
  ]);

  const PERIOD_LABEL: Record<string, string> = { DAY: "Diurno", NIGHT: "Noturno" };
  const STATUS_LABEL: Record<string, string> = {
    SCHEDULED: "Escalado", CONFIRMED: "Confirmado", CHECKED_IN: "Presente",
    CHECKED_OUT: "Finalizado", ABSENT: "Ausente", CANCELLED: "Cancelado",
  };

  const weekDaysTyped = weekDayRows as unknown as Array<{ date: string; total: number; present: number; absent: number }>;
  const weekTotalAll = weekDaysTyped.reduce((sum, d) => sum + d.total, 0);
  const weekPresentAll = weekDaysTyped.reduce((sum, d) => sum + d.present, 0);

  const relevantTotal = currentPeriod === "DAY" ? (s["today_day_total"] ?? 0) : (s["today_night_total"] ?? 0);
  const relevantCheckins = currentPeriod === "DAY" ? (s["today_day_checkins"] ?? 0) : (s["today_night_checkins"] ?? 0);

  const attendanceWindowAssignments = (assignmentRows as Record<string, unknown>[]).filter((row) =>
    isWithinAdminAttendanceWindow(String(row.date ?? "")),
  );
  const activeAttendanceRows = (activeRows as Record<string, unknown>[]).filter((row) =>
    isWithinAdminAttendanceWindow(String(row.date ?? "")),
  );

  const toDetail = (row: Record<string, unknown>) => ({
    name: String(row.name ?? ""),
    faculty: String(row.faculty ?? ""),
    extra: `${row.base_code ?? ""} — ${PERIOD_LABEL[String(row.period ?? "")] ?? ""}`,
  });

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

  const sortedAssignments = attendanceWindowAssignments
    .slice()
    .sort((a, b) => {
      const dateCompare = String(a.date ?? "").localeCompare(String(b.date ?? ""));
      if (dateCompare !== 0) return dateCompare;
      return baseViewIndex(String(a.base_code)) - baseViewIndex(String(b.base_code));
    });

  const baseDetailsMap: Record<string, DashboardData["baseDetails"][string]> = {};
  for (const r of baseDetailRows as Record<string, unknown>[]) {
    const code = String(r.base_code);
    if (!baseDetailsMap[code]) baseDetailsMap[code] = [];
    baseDetailsMap[code].push({
      internName: String(r.intern_name ?? ""),
      faculty: String(r.faculty ?? ""),
      period: String(r.period ?? ""),
      status: String(r.status ?? ""),
      checkinAt: r.checkin_at ? (r.checkin_at instanceof Date ? r.checkin_at.toISOString() : String(r.checkin_at)) : null,
      validatedBy: r.validated_by_name ? String(r.validated_by_name) : null,
      remanejado: String(r.notes ?? "").includes("[REMANEJADO]"),
    });
  }

  const sortedBases = (baseRows as unknown as DashboardData["bases"])
    .slice()
    .sort((a, b) => baseViewIndex(a.code) - baseViewIndex(b.code));

  const todayRoster = sortedAssignments.map((r) => ({
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    faculty: String(r.faculty ?? ""),
    baseCode: String(r.base_code ?? ""),
    date: String(r.date ?? ""),
    period: String(r.period ?? "") as "DAY" | "NIGHT",
    status: String(r.status ?? ""),
    remanejado: String(r.notes ?? "").includes("[REMANEJADO]"),
    isCarryover: String(r.date ?? "") !== today,
  }));

  return {
    s: { ...s, active_checkins: activeAttendanceRows.length },
    checkinRate: relevantTotal > 0 ? Math.round((relevantCheckins / relevantTotal) * 100) : 0,
    checkinSub: `${relevantCheckins} de ${relevantTotal} (${currentPeriod === "DAY" ? "diurno" : "noturno"})`,
    isDayShiftHours: currentPeriod === "DAY",
    weekRate: weekTotalAll > 0 ? Math.round((weekPresentAll / weekTotalAll) * 100) : 0,
    weekPresent: weekPresentAll,
    weekTotal: weekTotalAll,
    weekDays: weekDaysTyped,
    faculties: facultyRows as unknown as DashboardData["faculties"],
    bases: sortedBases,
    baseDetails: baseDetailsMap,
    dateLabel: new Date(`${calendarToday}T12:00:00Z`).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
    todayRoster,
    details: {
      absences: (absenceRows as Record<string, unknown>[]).map(toDetail),
      incidents,
      activeCheckins: activeAttendanceRows.map(toDetail),
      todayAssignments: sortedAssignments.map((r) => ({
        name: String(r.name ?? ""),
        faculty: String(r.faculty ?? ""),
        extra: `${r.base_code} — ${PERIOD_LABEL[String(r.period ?? "")] ?? ""} · ${new Date(`${String(r.date ?? today)}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" })} (${STATUS_LABEL[String(r.status)] ?? r.status})`,
      })),
      checkedIn: (checkedInRows as Record<string, unknown>[]).map(toDetail),
      todayCompleted: (completedDetailRows as Record<string, unknown>[]).map(toDetail),
      selfAssignments: (selfAssignmentRows as Record<string, unknown>[]).map(toDetail),
    },
  };
}
