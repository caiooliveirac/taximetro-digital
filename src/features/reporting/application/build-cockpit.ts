import { db } from "@/db";
import { sql } from "drizzle-orm";
import { addDaysToDateStr, operationalDateStr, operationalPeriod } from "@/lib/utils";
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
  // per-type weekly metas (já expostos por executeGetComplianceOverview).
  // CRL fora do trigger por decisão do produto — meta não-semanal estável.
  targetUSAPerWeek: number;
  targetCRUPerWeek: number;
  thisWeekUSAPlanned: number;
  thisWeekCRUPlanned: number;
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

  // Filtra apenas o turno operacional ATUAL e o ANTERIOR. Antes de 19h, não
  // faz sentido aparecer interno do noturno como "sem checkin" — ele nem foi
  // escalado pra começar ainda. Após 19h, o diurno do mesmo dia já fechou e
  // vira "anterior".
  const currDate = operationalDateStr();
  const currPeriod = operationalPeriod();
  const prevDate = currPeriod === "DAY" ? addDaysToDateStr(currDate, -1) : currDate;
  const prevPeriod: "DAY" | "NIGHT" = currPeriod === "DAY" ? "NIGHT" : "DAY";

  function matchesShift(date: string, period: string): boolean {
    return (date === currDate && period === currPeriod)
        || (date === prevDate && period === prevPeriod);
  }

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
    .filter((r) => matchesShift(r.date, r.period))
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

// Tipo conta como "abaixo da meta" quando o intern não tem o número-alvo
// de plantões DESTA SEMANA garantidos (cumpridos OU escalados). Captura
// dois cenários úteis pro coordenador:
//   - Leader não escalou: planned=0, target=1 → erro de leader, dispara
//   - Intern faltou e ninguém repôs: planned=0 (absent excluído) → dispara
// Não captura quando o intern já cumpriu OU já está escalado pra cumprir
// na própria semana.
//
// CRL deliberadamente fora — meta não-semanal por decisão do produto.
function isBelowType(intern: ComplianceIntern, type: "USA" | "CRU"): boolean {
  switch (type) {
    case "USA":
      return intern.targetUSAPerWeek > 0
        && intern.thisWeekUSAPlanned < intern.targetUSAPerWeek;
    case "CRU":
      return intern.targetCRUPerWeek > 0
        && intern.thisWeekCRUPlanned < intern.targetCRUPerWeek;
  }
}

function buildWeeklyBreakdown(intern: ComplianceIntern) {
  // Mostra somente os tipos que dispararam o alarme.
  // Valores são thisWeek-planned (cumpridos + escalados não-absent).
  const types: Array<{ type: "USA" | "CRU"; completed: number; target: number; below: boolean }> = [];
  if (isBelowType(intern, "USA")) {
    types.push({ type: "USA", completed: intern.thisWeekUSAPlanned, target: intern.targetUSAPerWeek, below: true });
  }
  if (isBelowType(intern, "CRU")) {
    types.push({ type: "CRU", completed: intern.thisWeekCRUPlanned, target: intern.targetCRUPerWeek, below: true });
  }
  return types;
}

function isBelowAnyTypeWeekly(intern: ComplianceIntern): boolean {
  return isBelowType(intern, "USA") || isBelowType(intern, "CRU");
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
