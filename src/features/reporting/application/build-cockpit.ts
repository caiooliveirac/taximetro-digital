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
  targetUSATotal: number;
  targetCRUTotal: number;
  thisWeekUSAPlanned: number;
  thisWeekCRUPlanned: number;
  // Cumulativo da rotação inteira (cumpridos + escalados não-absent).
  // Usado para suprimir alarme quando a meta semanal está coberta no calendário
  // total da rotação (variação por troca não é problema do coordenador).
  totalUSAPlanned: number;
  totalCRUPlanned: number;
  rotationStartDate: string | null;
  rotationEndDate: string | null;
  // Tempo decorrido/restante da rotação (em semanas). Usado pelo detector
  // de "atraso sem cobertura" para calibrar quando o saldo negativo
  // realmente vira alarme.
  weeksElapsed: number;
  weeksRemaining: number;
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

// Quantas semanas a rotação tem (do início ao fim da cohort).
// Usado pra derivar o target total por tipo quando faculties.target_*_total
// não está populado. Fallback conservador: 0 desabilita o suppressor.
function rotationDurationWeeks(intern: ComplianceIntern): number {
  if (!intern.rotationStartDate || !intern.rotationEndDate) return 0;
  const ms = new Date(`${intern.rotationEndDate}T12:00:00Z`).getTime()
           - new Date(`${intern.rotationStartDate}T12:00:00Z`).getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / (7 * 86_400_000)));
}

function expectedTotalForType(intern: ComplianceIntern, type: "USA" | "CRU"): number {
  const declared = type === "USA" ? intern.targetUSATotal : intern.targetCRUTotal;
  if (declared > 0) return declared;
  const perWeek = type === "USA" ? intern.targetUSAPerWeek : intern.targetCRUPerWeek;
  const weeks = rotationDurationWeeks(intern);
  return perWeek * weeks;
}

// Tipo conta como "abaixo da meta" quando o intern não tem o número-alvo
// de plantões DESTA SEMANA garantidos (cumpridos OU escalados) E a rotação
// como um todo NÃO tem o tipo coberto pelo calendário. Suprime quando:
//   - Coordenador já tem tudo escalado: troca/variação semanal não é alarme
//
// Captura ainda os cenários úteis pro coordenador:
//   - Leader não escalou e meta total descoberta: planned=0 → erro de leader
//   - Intern faltou, ninguém repôs e meta total descoberta: planned=0 → dispara
//
// CRL deliberadamente fora — meta não-semanal por decisão do produto.
function isBelowType(intern: ComplianceIntern, type: "USA" | "CRU"): boolean {
  const target = type === "USA" ? intern.targetUSAPerWeek : intern.targetCRUPerWeek;
  if (target === 0) return false;

  const thisWeekPlanned = type === "USA" ? intern.thisWeekUSAPlanned : intern.thisWeekCRUPlanned;
  if (thisWeekPlanned >= target) return false;

  // Suppressor: total da rotação já tem o tipo coberto (passado + futuro escalado).
  const totalPlanned = type === "USA" ? intern.totalUSAPlanned : intern.totalCRUPlanned;
  const expectedTotal = expectedTotalForType(intern, type);
  if (expectedTotal > 0 && totalPlanned >= expectedTotal) return false;

  return true;
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

// Detector de "atraso sem cobertura" — substituiu "faltou sem reposição".
//
// Invariante central: o sinal é o saldo agregado da rotação:
//   deficit = target − (completed + futureScheduled)
//
// Por construção, swap e remanejamento NÃO disparam (cancela 1 + cria 1
// preserva saldo). Absences COM reposição já agendada NÃO disparam
// (futureScheduled cobre). Disparam: ABSENT sem reposição, DROP_SHIFT
// aprovado sem reposição, remoção pelo líder sem reposição, e
// sub-alocação que vai estourar o calendário.
//
// Heurística B (UNIFACS-tolerant): no início da rotação tolera
// sub-alocação que ainda não foi corrigida — alocação incremental é
// legítima até a semana 2. A partir daí, deficit puro vira alarme.
// Se houver QUALQUER absence concreta (totalAbsent > 0), dispara
// independente da semana — perda factual já merece atenção.
//
// Distinção "cabe vs não cabe" mora no detail per-item, não na cor do
// card. Card mantém severity "danger" — qualquer atraso sem cobertura
// é acionável pelo coordenador.
function coverageGap(intern: ComplianceIntern): { deficit: number; detail: string } | null {
  if (intern.targetShifts <= 0) return null;

  const deficit = intern.targetShifts - (intern.totalCompleted + intern.futureScheduled);
  if (deficit <= 0) return null;

  // Heurística B: pré-semana-2 sem absence concreta = ainda em alocação.
  if (intern.weeksElapsed < 2 && intern.totalAbsent === 0) return null;

  const weekCapacity = Math.max(intern.targetShiftsPerWeek + 1, 3);
  const remaining = intern.weeksRemaining;
  const fits = remaining > 0 && remaining * weekCapacity >= deficit;

  const gap = `${deficit} plant${deficit > 1 ? "ões" : "ão"}`;
  let detail: string;
  if (remaining === 0) {
    detail = `faltam ${gap} · rotação encerrada`;
  } else if (!fits) {
    detail = `faltam ${gap} · não cabe em ${remaining}sem`;
  } else {
    detail = `faltam ${gap} · cabe em ${remaining}sem`;
  }

  return { deficit, detail };
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

  // Atraso sem cobertura: saldo da rotação não cobre o target, considerando
  // futuros não-cancelados como reposição válida. Ver `coverageGap` para a
  // motivação do invariante e a heurística B (UNIFACS-tolerant).
  // Ordenação por (faculdade, nome) pra permitir agrupamento no UI.
  const unreplacedItems: AlarmItem[] = complianceInterns
    .map((i) => {
      const gap = coverageGap(i);
      if (!gap) return null;
      return {
        internId: i.userId,
        internName: i.name,
        facultyAbbr: i.facultyAbbr ?? "",
        detail: gap.detail,
      } as AlarmItem;
    })
    .filter((it): it is AlarmItem => it !== null)
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
