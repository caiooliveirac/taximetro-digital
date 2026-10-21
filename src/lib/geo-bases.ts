import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bases, faculties } from "@/db/schema";
import { alternateBaseCodes, checkGeofenceWithAlternates } from "@/lib/geo";

type Base = typeof bases.$inferSelect;

/** Cerca do plantão: a da base e, no CRU, a da faculdade do interno (ver ALTERNATE_GEOFENCE_BASES). */
export async function checkAssignmentGeofence(
  lat: number, lng: number, base: Base, assignment: { facultyId: string },
) {
  let altCodes: string[] = [];
  if (base.code === "CRU") {
    const [fac] = await db.select({ abbreviation: faculties.abbreviation })
      .from(faculties).where(eq(faculties.id, assignment.facultyId)).limit(1);
    altCodes = alternateBaseCodes(base.code, fac?.abbreviation);
  }
  const alternates = altCodes.length
    ? await db.select().from(bases).where(and(inArray(bases.code, altCodes), eq(bases.isActive, true)))
    : [];
  return checkGeofenceWithAlternates(lat, lng, base, alternates);
}
