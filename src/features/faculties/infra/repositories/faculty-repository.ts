import { eq } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { faculties } from "@/shared/db/schema";

/** Metas diretas: o que a faculdade exige do interno na rotação inteira. */
export type FacultyTargets = {
  name: string;
  abbreviation: string;
  targetHours: number;
  targetUSAsTotal: number;
  targetCRUsTotal: number;
  targetCRLsTotal: number;
  totalInterns: number;
  rotationStartDate: string;
};

export async function listFaculties() {
  return db
    .select({
      id: faculties.id,
      name: faculties.name,
      abbreviation: faculties.abbreviation,
      targetHours: faculties.targetHours,
      targetUSAsTotal: faculties.targetUSAsTotal,
      targetCRUsTotal: faculties.targetCRUsTotal,
      targetCRLsTotal: faculties.targetCRLsTotal,
      totalInterns: faculties.totalInterns,
      isVirtual: faculties.isVirtual,
      rotationStartDate: faculties.rotationStartDate,
      createdAt: faculties.createdAt,
    })
    .from(faculties)
    .orderBy(faculties.abbreviation);
}

export async function createFaculty(values: FacultyTargets) {
  const [created] = await db.insert(faculties).values(values).returning();
  return created;
}

export async function updateFacultyById(params: {
  id: string;
  values: Partial<FacultyTargets>;
}) {
  const [updated] = await db.update(faculties).set(params.values).where(eq(faculties.id, params.id)).returning();
  return updated;
}
