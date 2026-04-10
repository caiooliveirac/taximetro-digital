import { eq } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { bases } from "@/shared/db/schema";

export async function listAllBases() {
  return db.select().from(bases).orderBy(bases.code);
}

export async function listActiveBases() {
  return db
    .select({ id: bases.id, code: bases.code, name: bases.name, type: bases.type })
    .from(bases)
    .where(eq(bases.isActive, true))
    .orderBy(bases.code);
}

export async function createBase(values: {
  code: string;
  name: string;
  type: "USA" | "CENTRAL" | "CRL";
  latitude: number;
  longitude: number;
  geoFenceMeters: number;
  isActive: boolean;
}) {
  const [created] = await db.insert(bases).values(values).returning();
  return created;
}

export async function updateBaseById(params: {
  id: string;
  values: Partial<{
    code: string;
    name: string;
    type: "USA" | "CENTRAL" | "CRL";
    latitude: number;
    longitude: number;
    geoFenceMeters: number;
    isActive: boolean;
  }>;
}) {
  const [updated] = await db.update(bases).set(params.values).where(eq(bases.id, params.id)).returning();
  return updated;
}

export async function findBaseById(id: string) {
  const [base] = await db.select().from(bases).where(eq(bases.id, id)).limit(1);
  return base;
}

export async function calibrateBaseCoords(params: {
  baseId: string;
  latitude: number;
  longitude: number;
}) {
  const [updated] = await db
    .update(bases)
    .set({ latitude: params.latitude, longitude: params.longitude })
    .where(eq(bases.id, params.baseId))
    .returning();

  return updated;
}
