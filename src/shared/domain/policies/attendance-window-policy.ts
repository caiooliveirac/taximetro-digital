import { db } from "@/shared/db/client";
import { assignments } from "@/shared/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export type ShiftPeriod = "DAY" | "NIGHT";

export type AttendanceAssignment = {
  id: string;
  internId: string;
  date: string;
  period: string;
  shift: string | null;
};

export function isUnifiedShiftCheckout(assignment: Pick<AttendanceAssignment, "period" | "shift">): boolean {
  return assignment.period === "DAY" &&
    (assignment.shift === "MORNING" || assignment.shift === "AFTERNOON");
}

export async function resolveCheckoutAssignmentIds(assignment: AttendanceAssignment): Promise<string[]> {
  if (!isUnifiedShiftCheckout(assignment)) return [assignment.id];

  const related = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.internId, assignment.internId),
        eq(assignments.date, assignment.date),
        eq(assignments.period, "DAY"),
        inArray(assignments.shift, ["MORNING", "AFTERNOON"]),
        eq(assignments.status, "CHECKED_IN"),
      ),
    );

  const ids = related.map((row) => row.id);
  if (!ids.includes(assignment.id)) ids.push(assignment.id);
  return ids;
}

export {
  validateShiftClockIn,
  isWithinAttendanceWindow,
  isWithinInternCheckoutWindow,
  isWithinShiftCheckoutWindow,
  isWithinAdminAttendanceWindow,
  operationalDateStr,
  operationalPeriod,
  isCurrentOperationalAssignment,
} from "@/lib/utils";
