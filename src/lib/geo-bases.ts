import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bases } from "@/db/schema";
import { ALTERNATE_GEOFENCE_BASES, checkGeofenceWithAlternates } from "@/lib/geo";

type Base = typeof bases.$inferSelect;

export async function checkAssignmentGeofence(lat: number, lng: number, base: Base) {
  const altCode = ALTERNATE_GEOFENCE_BASES[base.code];
  const alternates = altCode
    ? await db.select().from(bases).where(and(eq(bases.code, altCode), eq(bases.isActive, true)))
    : [];
  return checkGeofenceWithAlternates(lat, lng, base, alternates);
}
