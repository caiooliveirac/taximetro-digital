import { db } from "@/db";
import { sql } from "drizzle-orm";
import { isWithinAdminAttendanceWindow } from "@/lib/utils";
import { baseViewIndex } from "@/lib/base-colors";
import type { CockpitData, AlarmItem } from "@/components/admin/cockpit-alarms";

type ComplianceIntern = {
  userId: string;
  name: string;
  facultyAbbr?: string | null;
  totalAbsent: number;
  totalCompleted: number;
  futureScheduled: number;
  targetShifts: number;
  targetShiftsPerWeek: number;
  lastWeekCompleted: number;
  belowWeeklyTarget: boolean;
  // per-type weekly metas (already exposed by executeGetComplianceOverview)
  targetUSAPerWeek: number;
  targetCRUPerWeek: number;
  targetCRLPerWeek: number;
  lastWeekUSACompleted: number;
  lastWeekCRUCompleted: number;
  lastWeekCRLCompleted: number;
};

type NoCheckinRow = {
  intern_id: string;
  intern_name: string;
  faculty_abbr: string | null;
  base_code: string;
  period: string;
  date: string;
};

const PERIOD_LABEL: Record<string, string> = { DAY: "diurno", NIGHT: "noturno" };

export async function fetchNoCheckinNow(): Promise<NoCheckinRow[]> {
  // Plantões em janela de check-in admin que ainda não viraram check-in/absent.
  // Janela inclui dia anterior pra carryover do noturno (ver isWithinAdminAttendanceWindow).
  const rows = await db.execute(sql`
    SELECT
      a.intern_id::text AS intern_id,
      u.name AS intern_name,
      f.abbreviation AS faculty_abbr,
      b.code AS base_code,
      a.period,
      a.date::text AS date
    FROM assignments a
    JOIN users u ON u.id = a.intern_id
    JOIN bases b ON b.id = a.base_id
    JOIN faculties f ON f.id = a.faculty_id
    WHERE a.is_extra_shift = false
      AND a.status NOT IN ('CHECKED_IN','CHECKED_OUT','ABSENT','CANCELLED')
      AND a.date >= CURRENT_DATE - INTERVAL '1 day'
      AND a.date <= CURRENT_DATE
    ORDER BY a.date, u.name
  `);

  // JS-side filter por isWithinAdminAttendanceWindow pra ficar consistente
  // com o resto do dashboard que aplica essa policy (ver dashboard-query.ts).
  // Ordenação final: data → base por sufixo numérico (BASE_VIEW_ORDER) → nome.
  return (rows as Record<string, unknown>[])
    .map((r) => ({
      intern_id: String(r.intern_id ?? ""),
      intern_name: String(r.intern_name ?? ""),
      faculty_abbr: r.faculty_abbr ? String(r.faculty_abbr) : null,
      base_code: String(r.base_code ?? ""),
      period: String(r.period ?? ""),
      date: String(r.date ?? ""),
    }))
    .filter((r) => isWithinAdminAttendanceWindow(r.date))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const baseDiff = baseViewIndex(a.base_code) - baseViewIndex(b.base_code);
      if (baseDiff !== 0) return baseDiff;
      return a.intern_name.localeCompare(b.intern_name);
    });
}

function byFacultyThenName(a: { facultyAbbr: string; internName: string }, b: { facultyAbbr: string; internName: string }) {
  const fac = a.facultyAbbr.localeCompare(b.facultyAbbr);
  if (fac !== 0) return fac;
  return a.internName.localeCompare(b.internName);
}

function buildWeeklyBreakdown(intern: ComplianceIntern) {
  const types: Array<{ type: "USA" | "CRU" | "CRL"; completed: number; target: number; below: boolean }> = [];
  if (intern.targetUSAPerWeek > 0) {
    const completed = intern.lastWeekUSACompleted;
    const target = intern.targetUSAPerWeek;
    types.push({ type: "USA", completed, target, below: completed < target });
  }
  if (intern.targetCRUPerWeek > 0) {
    const completed = intern.lastWeekCRUCompleted;
    const target = intern.targetCRUPerWeek;
    types.push({ type: "CRU", completed, target, below: completed < target });
  }
  if (intern.targetCRLPerWeek > 0) {
    const completed = intern.lastWeekCRLCompleted;
    const target = intern.targetCRLPerWeek;
    types.push({ type: "CRL", completed, target, below: completed < target });
  }
  return types;
}

function isBelowAnyTypeWeekly(intern: ComplianceIntern): boolean {
  if (intern.targetUSAPerWeek > 0 && intern.lastWeekUSACompleted < intern.targetUSAPerWeek) return true;
  if (intern.targetCRUPerWeek > 0 && intern.lastWeekCRUCompleted < intern.targetCRUPerWeek) return true;
  if (intern.targetCRLPerWeek > 0 && intern.lastWeekCRLCompleted < intern.targetCRLPerWeek) return true;
  return false;
}

export function buildCockpitData(params: {
  complianceInterns: ComplianceIntern[];
  noCheckinRows: NoCheckinRow[];
}): CockpitData {
  const { complianceInterns, noCheckinRows } = params;

  // Sem check-in agora: ordem por base já aplicada em fetchNoCheckinNow.
  const noCheckinItems: AlarmItem[] = noCheckinRows.map((r) => ({
    internId: r.intern_id,
    internName: r.intern_name,
    facultyAbbr: r.faculty_abbr ?? "",
    detail: `${r.base_code} · ${PERIOD_LABEL[r.period] ?? r.period.toLowerCase()}`,
  }));

  // Faltou sem reposição: agregado por design (saldo da rotação).
  // Ordenação por (faculdade, nome) pra permitir agrupamento no UI.
  const unreplacedItems: AlarmItem[] = complianceInterns
    .filter((i) => i.totalAbsent > 0 && i.totalCompleted + i.futureScheduled < i.targetShifts)
    .map((i) => {
      const gap = Math.max(0, i.targetShifts - (i.totalCompleted + i.futureScheduled));
      return {
        internId: i.userId,
        internName: i.name,
        facultyAbbr: i.facultyAbbr ?? "",
        detail: `${i.totalAbsent} falta${i.totalAbsent > 1 ? "s" : ""} · faltam ${gap}`,
      };
    })
    .sort(byFacultyThenName);

  // Abaixo da meta semanal: trigger per-type — captura "compensou um tipo,
  // perdeu outro". Cada item carrega breakdown estruturado pra UI renderizar
  // badges per-type com cor por estado.
  const belowWeeklyItems: AlarmItem[] = complianceInterns
    .filter(isBelowAnyTypeWeekly)
    .map((i) => {
      const breakdown = buildWeeklyBreakdown(i);
      const fallbackParts = breakdown.map((b) => `${b.type} ${b.completed}/${b.target}`);
      return {
        internId: i.userId,
        internName: i.name,
        facultyAbbr: i.facultyAbbr ?? "",
        detail: fallbackParts.join(" · "),
        breakdown,
      };
    })
    .sort(byFacultyThenName);

  return {
    noCheckin: { count: noCheckinItems.length, items: noCheckinItems },
    unreplacedAbsence: { count: unreplacedItems.length, items: unreplacedItems },
    belowWeeklyTarget: { count: belowWeeklyItems.length, items: belowWeeklyItems },
  };
}
