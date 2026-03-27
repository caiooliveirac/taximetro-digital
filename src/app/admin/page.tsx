import { db } from "@/db";
import { sql } from "drizzle-orm";
import { AdminDashboardClient, type DashboardData } from "@/components/admin-dashboard";
import { baseViewIndex } from "@/lib/base-colors";
import { addDaysToDateStr, isWithinAdminAttendanceWindow, localDateStr, operationalDateStr, operationalPeriod } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  try {
    return await AdminDashboardContent();
  } catch (err) {
    console.error("[Admin] Dashboard error:", err);
    return <AdminDashboardError message={err instanceof Error ? err.message : "Erro desconhecido"} />;
  }
}

function AdminDashboardError({ message }: { message: string }) {
  const isDbError = message.includes("ECONNREFUSED") || message.includes("connect") || message.includes("timeout");
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <h2 className="mb-2 text-lg font-semibold text-red-800">
          {isDbError ? "Banco de dados indisponível" : "Erro ao carregar dashboard"}
        </h2>
        <p className="mb-4 text-sm text-red-600">
          {isDbError
            ? "Não foi possível conectar ao banco de dados. Verifique se o PostgreSQL está em execução."
            : "Ocorreu um erro inesperado ao carregar os dados."}
        </p>
        <a href="/taximetro/admin" className="inline-block rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
          Tentar novamente
        </a>
      </div>
    </div>
  );
}

async function AdminDashboardContent() {
  const today = operationalDateStr();
  const calendarToday = localDateStr();
  const previousCalendarDay = addDaysToDateStr(calendarToday, -1);
  const currentPeriod = operationalPeriod();
  const isDayShiftHours = currentPeriod === "DAY";
  const weekStart = addDaysToDateStr(today, -6);

  const [stats] = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE is_active = true) AS total_users,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status != 'CANCELLED') AS today_assignments,
      (SELECT COUNT(*)::int FROM checkins c JOIN assignments a ON a.id = c.assignment_id WHERE a.date = ${today} AND c.status = 'VALIDATED') AS today_checkins,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status = 'ABSENT') AS today_absences,
      (SELECT COUNT(*)::int FROM checkins c JOIN assignments a ON a.id = c.assignment_id WHERE a.date = ${today} AND c.geo_valid = false) AS geo_violations,
      (SELECT COUNT(*)::int FROM checkins c JOIN assignments a ON a.id = c.assignment_id WHERE a.date = ${today} AND c.status = 'EXPIRED') AS totp_expired,
      (SELECT COUNT(*)::int FROM assignments WHERE notes = '[AUTO_CRIADO]' AND date = ${today}) AS self_assignments,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status = 'CHECKED_IN') AS active_checkins,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status = 'CHECKED_OUT') AS completed,
      (SELECT COUNT(*)::int FROM bases WHERE is_active = true) AS base_count,
      (SELECT COUNT(*)::int FROM faculties) AS faculty_count,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status != 'CANCELLED' AND period = 'DAY') AS today_day_total,
      (SELECT COUNT(*)::int FROM checkins c JOIN assignments a ON a.id = c.assignment_id WHERE a.date = ${today} AND c.status = 'VALIDATED' AND a.period = 'DAY') AS today_day_checkins,
      (SELECT COUNT(*)::int FROM assignments WHERE date = ${today} AND status != 'CANCELLED' AND period = 'NIGHT') AS today_night_total,
      (SELECT COUNT(*)::int FROM checkins c JOIN assignments a ON a.id = c.assignment_id WHERE a.date = ${today} AND c.status = 'VALIDATED' AND a.period = 'NIGHT') AS today_night_checkins
  `);

  const s = stats as Record<string, number>;

  const relevantTotal = currentPeriod === "DAY" ? (s["today_day_total"] ?? 0) : (s["today_night_total"] ?? 0);
  const relevantCheckins = currentPeriod === "DAY" ? (s["today_day_checkins"] ?? 0) : (s["today_night_checkins"] ?? 0);
  const checkinRate = relevantTotal > 0 ? Math.round((relevantCheckins / relevantTotal) * 100) : 0;

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
          a.period, a.status, a.notes,
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

  // Week per-day breakdown (last 7 days, all non-cancelled)
  const weekDayRows = await db.execute(sql`
    SELECT
      a.date::text AS date,
      COUNT(*)::int AS total,
      COUNT(CASE WHEN a.status IN ('CHECKED_IN', 'CHECKED_OUT') THEN 1 END)::int AS present,
      COUNT(CASE WHEN a.status = 'ABSENT' THEN 1 END)::int AS absent
    FROM assignments a
    WHERE a.date >= ${weekStart}
      AND a.date <= ${today}
      AND a.status != 'CANCELLED'
    GROUP BY a.date ORDER BY a.date
  `);

  // Compute consolidated week totals from per-day data
  const weekDaysTyped = weekDayRows as unknown as Array<{ date: string; total: number; present: number; absent: number }>;
  const weekTotalAll = weekDaysTyped.reduce((sum, d) => sum + d.total, 0);
  const weekPresentAll = weekDaysTyped.reduce((sum, d) => sum + d.present, 0);
  const computedWeekRate = weekTotalAll > 0 ? Math.round((weekPresentAll / weekTotalAll) * 100) : 0;

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
      WHERE a.date >= ${previousCalendarDay} AND a.date <= ${today} AND a.status = 'CHECKED_IN'
      ORDER BY a.date, u.name
    `),
    db.execute(sql`
      SELECT a.id, u.name, f.abbreviation AS faculty, b.code AS base_code, a.period, a.status, a.date, a.notes
      FROM assignments a JOIN users u ON u.id = a.intern_id JOIN bases b ON b.id = a.base_id JOIN faculties f ON f.id = a.faculty_id
      WHERE a.date >= ${previousCalendarDay} AND a.date <= ${today} AND a.status != 'CANCELLED'
      ORDER BY a.date, b.code, a.period, u.name
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

  const attendanceWindowAssignments = (assignmentRows as Record<string, unknown>[]).filter((row) => {
    const date = String(row.date ?? "");
    return isWithinAdminAttendanceWindow(date);
  });

  const activeAttendanceRows = (activeRows as Record<string, unknown>[]).filter((row) => {
    const date = String(row.date ?? "");
    return isWithinAdminAttendanceWindow(date);
  });

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
  const sortedAssignments = attendanceWindowAssignments
    .slice()
    .sort((a, b) => {
      const dateCompare = String(a.date ?? "").localeCompare(String(b.date ?? ""));
      if (dateCompare !== 0) return dateCompare;
      return baseViewIndex(String(a.base_code)) - baseViewIndex(String(b.base_code));
    });

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
      checkinAt: r.checkin_at ? (r.checkin_at instanceof Date ? r.checkin_at.toISOString() : String(r.checkin_at)) : null,
      validatedBy: r.validated_by_name ? String(r.validated_by_name) : null,
      remanejado: String(r.notes ?? "").includes("[REMANEJADO]"),
    });
  }

  // Sort bases by view order
  const sortedBases = (baseRows as unknown as DashboardData["bases"])
    .slice()
    .sort((a, b) => baseViewIndex(a.code) - baseViewIndex(b.code));

  // Build todayRoster — rich data for Plantões Hoje + Check-ins Hoje modals
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

  const data: DashboardData = {
    s: {
      ...s,
      active_checkins: activeAttendanceRows.length,
    },
    checkinRate,
    checkinSub: `${relevantCheckins} de ${relevantTotal} (${currentPeriod === "DAY" ? "diurno" : "noturno"})`,
    isDayShiftHours,
    weekRate: computedWeekRate,
    weekPresent: weekPresentAll,
    weekTotal: weekTotalAll,
    weekDays: weekDaysTyped,
    faculties: facultyRows as unknown as DashboardData["faculties"],
    bases: sortedBases,
    baseDetails: baseDetailsMap,
    dateLabel: new Date(`${calendarToday}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" }),
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

  return <AdminDashboardClient data={data} />;
}
