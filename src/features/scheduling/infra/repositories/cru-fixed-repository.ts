import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { cruFixedAssignments, userRoles } from "@/shared/db/schema";

export async function listActiveCruFixedByFaculty(facultyId: string) {
  return db.execute(sql`
    SELECT cfa.id, cfa.intern_id, u.name AS intern_name,
           cfa.day_of_week, cfa.period, cfa.valid_until, cfa.is_active
    FROM cru_fixed_assignments cfa
    JOIN users u ON u.id = cfa.intern_id
    WHERE cfa.faculty_id = ${facultyId}
      AND cfa.is_active = true
      AND cfa.valid_until >= CURRENT_DATE
    ORDER BY
      CASE cfa.day_of_week
        WHEN 'MON' THEN 0 WHEN 'TUE' THEN 1 WHEN 'WED' THEN 2
        WHEN 'THU' THEN 3 WHEN 'FRI' THEN 4 WHEN 'SAT' THEN 5 WHEN 'SUN' THEN 6
      END,
      cfa.period, u.name
  `);
}

export async function internBelongsToFaculty(params: {
  internId: string;
  facultyId: string;
}) {
  const internRole = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(and(
      eq(userRoles.userId, params.internId),
      eq(userRoles.facultyId, params.facultyId),
      inArray(userRoles.role, ["INTERN", "LEADER"]),
    ))
    .limit(1);

  return internRole.length > 0;
}

export async function findCruFixedTemplate(params: {
  internId: string;
  dayOfWeek: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
  period: "DAY" | "NIGHT";
}) {
  const [existing] = await db
    .select({ id: cruFixedAssignments.id })
    .from(cruFixedAssignments)
    .where(and(
      eq(cruFixedAssignments.internId, params.internId),
      eq(cruFixedAssignments.dayOfWeek, params.dayOfWeek),
      eq(cruFixedAssignments.period, params.period),
    ))
    .limit(1);

  return existing;
}

export async function upsertCruFixedTemplate(params: {
  existingId?: string;
  internId: string;
  facultyId: string;
  dayOfWeek: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
  period: "DAY" | "NIGHT";
  createdBy: string;
  validUntil: string;
}) {
  if (params.existingId) {
    await db
      .update(cruFixedAssignments)
      .set({
        facultyId: params.facultyId,
        createdBy: params.createdBy,
        validUntil: params.validUntil,
        isActive: true,
      })
      .where(eq(cruFixedAssignments.id, params.existingId));

    return params.existingId;
  }

  const [createdTemplate] = await db
    .insert(cruFixedAssignments)
    .values({
      internId: params.internId,
      facultyId: params.facultyId,
      dayOfWeek: params.dayOfWeek,
      period: params.period,
      createdBy: params.createdBy,
      validUntil: params.validUntil,
    })
    .returning({ id: cruFixedAssignments.id });

  return createdTemplate.id;
}

export async function findCruFixedTemplateByIdForFaculty(params: {
  id: string;
  facultyId: string;
}) {
  const [current] = await db
    .select({
      id: cruFixedAssignments.id,
      internId: cruFixedAssignments.internId,
      facultyId: cruFixedAssignments.facultyId,
      dayOfWeek: cruFixedAssignments.dayOfWeek,
      period: cruFixedAssignments.period,
      validUntil: cruFixedAssignments.validUntil,
    })
    .from(cruFixedAssignments)
    .where(and(
      eq(cruFixedAssignments.id, params.id),
      eq(cruFixedAssignments.facultyId, params.facultyId),
    ))
    .limit(1);

  return current;
}

export async function deactivateCruFixedTemplateForFaculty(params: {
  id: string;
  facultyId: string;
}) {
  await db
    .update(cruFixedAssignments)
    .set({ isActive: false })
    .where(and(
      eq(cruFixedAssignments.id, params.id),
      eq(cruFixedAssignments.facultyId, params.facultyId),
    ));
}

export async function countCruFixedTemplatesForWeek(params: {
  facultyId: string;
  weekStart: string;
}) {
  const templates = await db
    .select({ id: cruFixedAssignments.id })
    .from(cruFixedAssignments)
    .where(and(
      eq(cruFixedAssignments.facultyId, params.facultyId),
      eq(cruFixedAssignments.isActive, true),
      sql`${cruFixedAssignments.validUntil} >= ${params.weekStart}`,
    ));

  return templates.length;
}
