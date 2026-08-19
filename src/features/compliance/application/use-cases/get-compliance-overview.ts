import {
  addDaysToDateStr,
  localDateStr,
  operationalDateStr,
  startOfWeekDateStr,
  sumAssignmentHours,
  weeksBetweenDateStr,
} from "@/lib/utils";
import {
  listActiveComplianceSubjects,
  listNonCancelledAssignmentsForInterns,
} from "@/features/compliance/infra/repositories/compliance-repository";

// EXCUSED conta como cumprido: abono libera o interno da reposição.
const COMPLETED = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "EXCUSED"] as const;

function weekBounds(offset: number) {
  const operationalToday = operationalDateStr();
  const monday = addDaysToDateStr(startOfWeekDateStr(operationalToday), offset * 7);
  return {
    from: monday,
    to: addDaysToDateStr(monday, 6),
  };
}

type Actor = {
  id: string;
  role: string;
  facultyId: string | null;
};

export async function executeGetComplianceOverview(params: {
  actor: Actor;
  selfOnly?: boolean;
  facultyId?: string | null;
  internId?: string | null;
}) {
  const { actor, selfOnly = false, internId } = params;
  let facultyId = params.facultyId ?? null;

  if (actor.role === "LEADER" && actor.facultyId && !selfOnly) {
    facultyId = actor.facultyId;
  }

  let personOnly: string | null = null;
  let roleFilter: Array<"INTERN" | "LEADER"> = ["INTERN"];
  if (selfOnly && (actor.role === "INTERN" || actor.role === "LEADER")) {
    personOnly = actor.id;
    roleFilter = actor.role === "LEADER" ? ["INTERN", "LEADER"] : ["INTERN"];
  } else if (actor.role === "INTERN") {
    personOnly = actor.id;
  } else if (actor.role === "COORDINATOR" && internId) {
    personOnly = internId;
  }

  const rawInternRows = await listActiveComplianceSubjects({
    roleFilter,
    facultyId: facultyId ?? undefined,
    personOnly: personOnly ?? undefined,
  });

  const internMap = new Map<string, Omit<(typeof rawInternRows)[number], "role">>();
  for (const row of rawInternRows) {
    if (!internMap.has(row.userId)) {
      const { role: _role, ...intern } = row;
      internMap.set(row.userId, intern);
    }
  }

  const interns = [...internMap.values()];
  const thisWeek = weekBounds(0);
  const lastWeek = weekBounds(-1);

  if (interns.length === 0) {
    return {
      data: [],
      summary: {
        totalInterns: 0,
        belowWeeklyTarget: 0,
        belowTotalTarget: 0,
        compensating: 0,
        weekRange: { thisWeek, lastWeek },
      },
    };
  }

  const allAssignments = await listNonCancelledAssignmentsForInterns(interns.map((i) => i.userId));
  const todayStr = operationalDateStr();

  const assignmentsByIntern = new Map<string, typeof allAssignments>();
  for (const assignment of allAssignments) {
    const list = assignmentsByIntern.get(assignment.internId) ?? [];
    list.push(assignment);
    assignmentsByIntern.set(assignment.internId, list);
  }

  const data = interns.map((intern) => {
    const rows = assignmentsByIntern.get(intern.userId) ?? [];
    
    // Filter assignments from rotation start date onwards
    const rotationStart = intern.rotationStartDate || todayStr;
    const relevantRows = rows.filter((r) => r.date >= rotationStart);
    
    const pastRows = relevantRows.filter((r) => r.date <= todayStr);
    const completedPastRows = pastRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number]));
    const totalCompleted = completedPastRows.length;
    const totalCompletedHours = sumAssignmentHours(completedPastRows);
    const totalAbsent = pastRows.filter((r) => r.status === "ABSENT").length;

    const futureRows = relevantRows.filter((r) => r.date > todayStr);
    const futureScheduled = futureRows.length;
    const totalScheduled = relevantRows.length;

    const thisWeekRows = relevantRows.filter((r) => r.date >= thisWeek.from && r.date <= thisWeek.to);
    const thisWeekCompleted = thisWeekRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number])).length;
    const thisWeekAbsent = thisWeekRows.filter((r) => r.status === "ABSENT").length;
    const thisWeekScheduled = thisWeekRows.length;

    const lastWeekRows = relevantRows.filter((r) => r.date >= lastWeek.from && r.date <= lastWeek.to);
    const lastWeekCompleted = lastWeekRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number])).length;

    // Segmented by base type (USA/CRU/CRL) — counts completions + futures for this week
    const totalUSACompleted = pastRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number]) && r.baseType === "USA").length;
    const totalCRUCompleted = pastRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number]) && r.baseType === "CENTRAL").length;
    const totalCRLCompleted = pastRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number]) && r.baseType === "CRL").length;

    // For weekly deficits, count all planned shifts in the week (completed + scheduled), excluding absences
    const thisWeekUSAPlanned = thisWeekRows.filter((r) => r.baseType === "USA" && r.status !== "ABSENT").length;
    const thisWeekCRUPlanned = thisWeekRows.filter((r) => r.baseType === "CENTRAL" && r.status !== "ABSENT").length;
    const thisWeekCRLPlanned = thisWeekRows.filter((r) => r.baseType === "CRL" && r.status !== "ABSENT").length;

    // Cumulativo da rotação inteira (passado + futuro escalado, exceto ausências).
    // Usado pelo cockpit para suprimir o alarme semanal quando a rotação como
    // um todo já tem o tipo coberto — evita falso-positivo por troca de turno.
    const totalUSAPlanned = relevantRows.filter((r) => r.baseType === "USA" && r.status !== "ABSENT").length;
    const totalCRUPlanned = relevantRows.filter((r) => r.baseType === "CENTRAL" && r.status !== "ABSENT").length;
    const totalCRLPlanned = relevantRows.filter((r) => r.baseType === "CRL" && r.status !== "ABSENT").length;

    const lastWeekUSACompleted = lastWeekRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number]) && r.baseType === "USA").length;
    const lastWeekCRUCompleted = lastWeekRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number]) && r.baseType === "CENTRAL").length;
    const lastWeekCRLCompleted = lastWeekRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number]) && r.baseType === "CRL").length;

    // Quantos plantões cada tipo TINHA escalado na semana passada (todos os
    // não-cancelados, incluindo absences — o intern foi exposto à meta).
    // Usado pelo cockpit pra evitar falso-positivo de "abaixo da meta" quando
    // o tipo nem foi alocado pra meta nominal naquela semana.
    const lastWeekUSAPlanned = lastWeekRows.filter((r) => r.baseType === "USA").length;
    const lastWeekCRUPlanned = lastWeekRows.filter((r) => r.baseType === "CENTRAL").length;
    const lastWeekCRLPlanned = lastWeekRows.filter((r) => r.baseType === "CRL").length;

    const weeklyTarget = intern.targetShiftsPerWeek ?? 0;
    const targetUSAPerWeek = intern.targetUSAsPerWeek ?? 0;
    const targetUSATotal = intern.targetUSAsTotal ?? 0;
    const targetCRUPerWeek = intern.targetCRUsPerWeek ?? 0;
    const targetCRUTotal = intern.targetCRUsTotal ?? 0;
    const targetCRLPerWeek = intern.targetCRLsPerWeek ?? 0;

    // Weekly deficit: count what's missing THIS WEEK considering scheduled future
    const thisWeekUSAScheduledOrCompleted = thisWeekUSAPlanned;
    const thisWeekCRUScheduledOrCompleted = thisWeekCRUPlanned;
    const thisWeekCRLScheduledOrCompleted = thisWeekCRLPlanned;

    const weeklyUSADeficit = Math.max(0, targetUSAPerWeek - thisWeekUSAScheduledOrCompleted);
    const weeklyCRUDeficit = Math.max(0, targetCRUPerWeek - thisWeekCRUScheduledOrCompleted);
    const weeklyCRLDeficit = Math.max(0, targetCRLPerWeek - thisWeekCRLScheduledOrCompleted);

    let expectedToNow = 0;
    let weeksElapsed = 0;
    if (weeklyTarget > 0 && relevantRows.length > 0) {
      const rotationMonStr = startOfWeekDateStr(rotationStart);
      weeksElapsed = weeksBetweenDateStr(rotationMonStr, thisWeek.from) + 1;
      expectedToNow = weeksElapsed * weeklyTarget;
    }

    // Semanas restantes até o fim da rotação (cohort.endDate). 0 quando a
    // rotação acabou ou não há cohort vinculada — o consumidor decide se
    // isso vira "rotação encerrada" ou apenas degrada o detector.
    let weeksRemaining = 0;
    if (intern.rotationEndDate) {
      const rem = weeksBetweenDateStr(todayStr, intern.rotationEndDate);
      weeksRemaining = Math.max(0, rem);
    }

    // Numeração rígida de semanas seg-dom da rotação (Sem 1, Sem 2, ...).
    // Sem 1 = semana ISO da segunda-feira que contém rotationStartDate.
    // Usado pelo cockpit para "esperado-até-agora = semanaCorrente × meta/sem".
    //
    // Calendar date (sem carryover do noturno): a contagem de semanas é uma
    // visão de calendário, não operacional. Se for 23h59 de domingo, ainda
    // estamos na semana corrente — só vira Sem N+1 na meia-noite de segunda.
    let semanaCorrente = 0;
    let semanaTotal: number | null = null;
    if (intern.rotationStartDate) {
      const sem1Start = startOfWeekDateStr(intern.rotationStartDate);
      const calToday = localDateStr();
      if (intern.rotationEndDate) {
        // Total de semanas da rotação (Sem 1 → Sem N inclusive).
        // weeksBetweenDateStr é um floor; +1 cobre rotação parcial na última semana.
        semanaTotal = Math.max(1, weeksBetweenDateStr(sem1Start, intern.rotationEndDate) + 1);
      }
      if (calToday < intern.rotationStartDate) {
        semanaCorrente = 0; // rotação ainda não começou
      } else if (intern.rotationEndDate && calToday > intern.rotationEndDate) {
        semanaCorrente = semanaTotal ?? 0; // trava no fim
      } else {
        semanaCorrente = weeksBetweenDateStr(sem1Start, calToday) + 1;
      }
    }

    const rawDeficit = Math.max(0, expectedToNow - totalCompleted);
    const netDeficit = Math.max(0, rawDeficit - futureScheduled);
    const compensating = rawDeficit > 0 && futureScheduled > 0 && netDeficit === 0;
    const totalDeficit = Math.max(0, (intern.targetShifts ?? 0) - totalCompleted);
    const weeklyDeficit = Math.max(0, weeklyTarget - lastWeekCompleted);
    const belowWeeklyTarget = weeklyTarget > 0 && lastWeekCompleted < weeklyTarget;

    const totalPct = (intern.targetShifts ?? 0) > 0
      ? Math.min(100, Math.round((totalCompleted / intern.targetShifts!) * 100))
      : null;

    let status: "ok" | "compensating" | "partial" | "deficit" = "ok";
    if (rawDeficit > 0) {
      if (netDeficit === 0) status = "compensating";
      else if (futureScheduled > 0) status = "partial";
      else status = "deficit";
    }

    return {
      userId: intern.userId,
      name: intern.name,
      facultyId: intern.facultyId,
      facultyAbbr: intern.facultyAbbr,
      rotationStartDate: intern.rotationStartDate,
      rotationEndDate: intern.rotationEndDate,
      targetShifts: intern.targetShifts ?? 0,
      targetHours: intern.targetHours ?? 0,
      targetShiftsPerWeek: intern.targetShiftsPerWeek ?? 0,
      targetUSAPerWeek,
      targetUSATotal,
      targetCRUPerWeek,
      targetCRUTotal,
      targetCRLPerWeek,
      totalScheduled,
      totalCompleted,
      totalAbsent,
      totalUSACompleted,
      totalCRUCompleted,
      totalCRLCompleted,
      totalUSAPlanned,
      totalCRUPlanned,
      totalCRLPlanned,
      totalHours: totalCompletedHours,
      totalDeficit,
      totalPct,
      expectedToNow,
      weeksElapsed,
      weeksRemaining,
      semanaCorrente,
      semanaTotal,
      rawDeficit,
      futureScheduled,
      netDeficit,
      compensating,
      status,
      thisWeekScheduled,
      thisWeekCompleted,
      thisWeekAbsent,
      lastWeekCompleted,
      lastWeekUSACompleted,
      lastWeekCRUCompleted,
      lastWeekCRLCompleted,
      lastWeekUSAPlanned,
      lastWeekCRUPlanned,
      lastWeekCRLPlanned,
      thisWeekUSAPlanned,
      thisWeekCRUPlanned,
      thisWeekCRLPlanned,
      weeklyUSADeficit,
      weeklyCRUDeficit,
      weeklyCRLDeficit,
      weeklyDeficit,
      belowWeeklyTarget,
    };
  });

  data.sort((a, b) => a.name.localeCompare(b.name));

  return {
    data,
    summary: {
      totalInterns: data.length,
      belowWeeklyTarget: data.filter((d) => d.belowWeeklyTarget).length,
      belowTotalTarget: data.filter((d) => d.totalDeficit > 0).length,
      compensating: data.filter((d) => d.status === "compensating").length,
      weekRange: { thisWeek, lastWeek },
    },
  };
}
