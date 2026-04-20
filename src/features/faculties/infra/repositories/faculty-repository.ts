import { eq } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { faculties } from "@/shared/db/schema";

export async function listFaculties() {
  return db.select().from(faculties).orderBy(faculties.abbreviation);
}

export async function createFaculty(values: {
  name: string;
  abbreviation: string;
  targetHours: number;
  targetShifts: number;
  targetShiftsPerWeek: number;
  targetUSAsPerWeek: number;
  targetUSAsTotal: number;
  targetCRUsPerWeek: number;
  targetCRUsTotal: number;
  targetCRLsPerWeek: number;
  totalInterns: number;
  rotationStartDate: string;
}) {
  const [created] = await db.insert(faculties).values(values).returning();
  return created;
}

export async function updateFacultyById(params: {
  id: string;
  values: Partial<{
    name: string;
    abbreviation: string;
    targetHours: number;
    targetShifts: number;
    targetShiftsPerWeek: number;
    targetUSAsPerWeek: number;
    targetUSAsTotal: number;
    targetCRUsPerWeek: number;
    targetCRUsTotal: number;
    targetCRLsPerWeek: number;
    totalInterns: number;
    rotationStartDate: string;
  }>;
}) {
  const [updated] = await db.update(faculties).set(params.values).where(eq(faculties.id, params.id)).returning();
  return updated;
}
