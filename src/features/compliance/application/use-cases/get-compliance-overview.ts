import {
  addDaysToDateStr,
  operationalDateStr,
  startOfWeekDateStr,
  weeksBetweenDateStr,
} from "@/lib/utils";
import {
  listActiveComplianceSubjects,
  listNonCancelledAssignmentsForInterns,
} from "@/features/compliance/infra/repositories/compliance-repository";

const COMPLETED = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] as const;

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
    const pastRows = rows.filter((r) => r.date <= todayStr);
    const totalCompleted = pastRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number])).length;
    const totalAbsent = pastRows.filter((r) => r.status === "ABSENT").length;

    const futureRows = rows.filter((r) => r.date > todayStr);
    const futureScheduled = futureRows.length;
    const totalScheduled = rows.length;

    const thisWeekRows = rows.filter((r) => r.date >= thisWeek.from && r.date <= thisWeek.to);
    const thisWeekCompleted = thisWeekRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number])).length;
    const thisWeekAbsent = thisWeekRows.filter((r) => r.status === "ABSENT").length;
    const thisWeekScheduled = thisWeekRows.length;

    const lastWeekRows = rows.filter((r) => r.date >= lastWeek.from && r.date <= lastWeek.to);
    const lastWeekCompleted = lastWeekRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number])).length;

    // Segmented by base type (USA/CRU/CRL)
    const totalUSACompleted = pastRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number]) && r.baseType === "USA").length;
    const totalCRUCompleted = pastRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number]) && r.baseType === "CENTRAL").length;
    const totalCRLCompleted = pastRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number]) && r.baseType === "CRL").length;

    const lastWeekUSACompleted = lastWeekRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number]) && r.baseType === "USA").length;
    const lastWeekCRUCompleted = lastWeekRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number]) && r.baseType === "CENTRAL").length;
    const lastWeekCRLCompleted = lastWeekRows.filter((r) => COMPLETED.includes(r.status as typeof COMPLETED[number]) && r.baseType === "CRL").length;

    const weeklyTarget = intern.targetShiftsPerWeek ?? 0;
    const targetUSAPerWeek = intern.targetUSAsPerWeek ?? 0;
    const targetCRUPerWeek = intern.targetCRUsPerWeek ?? 0;
    const targetCRLPerWeek = intern.targetCRLsPerWeek ?? 0;

    // Debt is calculated from week-to-week progress (last week deficit)
    const weeklyUSADeficit = Math.max(0, targetUSAPerWeek - lastWeekUSACompleted);
    const weeklyCRUDeficit = Math.max(0, targetCRUPerWeek - lastWeekCRUCompleted);
    const weeklyCRLDeficit = Math.max(0, targetCRLPerWeek - lastWeekCRLCompleted);

    let expectedToNow = 0;
    if (weeklyTarget > 0 && rows.length > 0) {
      const earliest = rows.reduce((min, r) => r.date < min ? r.date : min, rows[0].date);
      const earlyMonStr = startOfWeekDateStr(earliest);
      const weeksElapsed = weeksBetweenDateStr(earlyMonStr, thisWeek.from) + 1;
      expectedToNow = weeksElapsed * weeklyTarget;
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
      targetShifts: intern.targetShifts ?? 0,
      targetHours: intern.targetHours ?? 0,
      targetShiftsPerWeek: intern.targetShiftsPerWeek ?? 0,
      targetUSAPerWeek,
      targetCRUPerWeek,
      targetCRLPerWeek,
      totalScheduled,
      totalCompleted,
      totalAbsent,
      totalUSACompleted,
      totalCRUCompleted,
      totalCRLCompleted,
      totalHours: totalCompleted * 12,
      totalDeficit,
      totalPct,
      expectedToNow,
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
