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
  targetUSAPerWeek: number;
  targetCRUPerWeek: number;
  targetUSATotal: number;
  targetCRUTotal: number;
  // CRL: meta cumulativa, não semanal (ex: 1 plantão na rotação inteira).
  targetCRLPerWeek: number;
  thisWeekUSAPlanned: number;
  thisWeekCRUPlanned: number;
  // Cumulativo da rotação inteira (cumpridos + escalados não-absent).
  // Usado pelo detector "esperado-até-agora = semanaCorrente × meta/sem".
  totalUSAPlanned: number;
  totalCRUPlanned: number;
  totalCRLPlanned: number;
  rotationStartDate: string | null;
  rotationEndDate: string | null;
  // Tempo decorrido/restante da rotação (em semanas). Mantido por consumidores
  // legados; o detector novo usa semanaCorrente abaixo.
  weeksElapsed: number;
  weeksRemaining: number;
  // Numeração rígida seg-dom da rotação. semanaCorrente cresce 1 a cada
  // segunda-feira a partir de Sem 1; trava em semanaTotal após cohort.endDate.
  // 0 quando rotação ainda não começou ou intern sem rotationStartDate.
  semanaCorrente: number;
  semanaTotal: number | null;
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

// Detector de "atraso sem cobertura" — limiar semanal linear por tipo.
//
// Invariante central: para USA e CRU, o esperado-até-agora cresce 1 a cada
// segunda-feira da rotação (Sem 1 = 1×meta/sem, Sem 3 = 3×meta/sem, etc).
// O realizado é cumpridos + escalados em qualquer ponto da rotação (passado
// ou futuro), o que faz excess de uma semana cobrir gap de outra
// automaticamente — saldo da rotação preserva.
//
//   debt[T] = max(0, semanaCorrente × meta[T]/sem − totalPlanned[T])
//
// CRL é especial: meta é cumulativa (ex: 1 plantão na rotação inteira),
// não semanal. Compara direto com o realizado.
//
//   debt[CRL] = max(0, targetCRLTotal − totalCRLPlanned)
//
// Comportamentos garantidos:
// - SWAP/remanejamento: cancela em uma data, cria em outra → totalPlanned
//   preserva → não dispara.
// - ABSENT com reposição já agendada: scheduled futuro entra em totalPlanned
//   → cobre o esperado → não dispara.
// - ABSENT/DROP/remoção sem reposição: totalPlanned cai → debt > 0 → dispara.
// - Líder não escalou Sem N (corrente ou passada): totalPlanned < esperado
//   → dispara, sem precisar virar absence.
// - Semanas futuras vazias (UNIFACS alocando incrementalmente):
//   semanaCorrente conta só até hoje, então gaps em Sem futura não geram
//   débito — não há falso positivo natural pra alocação em curso.
//
// Trava: se intern não tem rotationStartDate (sem cohort + sem
// faculties.rotationStartDate), retorna null — não há base pra calcular.
function coverageGap(intern: ComplianceIntern): { detail: string } | null {
  if (!intern.semanaCorrente || intern.semanaCorrente <= 0) return null;
  const sem = intern.semanaCorrente;

  const expectedUSA = sem * intern.targetUSAPerWeek;
  const expectedCRU = sem * intern.targetCRUPerWeek;
  // CRL: targetCRLPerWeek é tratado como meta TOTAL (semantic do produto:
  // "1 plantão CRL na vida da rotação", não 1 por semana).
  const expectedCRL = intern.targetCRLPerWeek;

  const debtUSA = Math.max(0, expectedUSA - intern.totalUSAPlanned);
  const debtCRU = Math.max(0, expectedCRU - intern.totalCRUPlanned);
  const debtCRL = Math.max(0, expectedCRL - intern.totalCRLPlanned);

  if (debtUSA === 0 && debtCRU === 0 && debtCRL === 0) return null;

  const parts: string[] = [];
  if (debtUSA > 0) parts.push(`USA ${intern.totalUSAPlanned}/${expectedUSA}`);
  if (debtCRU > 0) parts.push(`CRU ${intern.totalCRUPlanned}/${expectedCRU}`);
  if (debtCRL > 0) parts.push(`CRL ${intern.totalCRLPlanned}/${expectedCRL}`);

  const semLabel = `Sem ${sem}`;
  return { detail: `${semLabel} · ${parts.join(" · ")}` };
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
