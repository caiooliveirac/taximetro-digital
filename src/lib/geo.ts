const R = 6_371_000; // Earth radius in meters

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isWithinGeofence(
  internLat: number, internLng: number,
  baseLat: number, baseLng: number,
  fenceMeters: number,
): { valid: boolean; distance: number } {
  const distance = haversineDistance(internLat, internLng, baseLat, baseLng);
  return { valid: distance <= fenceMeters, distance: Math.round(distance) };
}

/**
 * Bases cujo check-in também vale dentro da cerca de outra base — só para o
 * plantão na base CRU (nunca USA/CRL) e só para interno das faculdades listadas:
 * Zarns/UNIFACS na base FACULDADE, EBMSP na ADAB (Bahiana de Brotas).
 */
export const ALTERNATE_GEOFENCE_BASES: Record<string, { code: string; faculties: string[] }[]> = {
  CRU: [
    { code: "FACULDADE", faculties: ["ZARNS", "UNIFACS"] },
    { code: "ADAB", faculties: ["EBMSP"] },
  ],
};

/** Códigos das bases alternativas que valem para este plantão (base + faculdade do interno). */
export function alternateBaseCodes(baseCode: string, facultyAbbr: string | null | undefined): string[] {
  const abbr = facultyAbbr?.toUpperCase();
  return (ALTERNATE_GEOFENCE_BASES[baseCode] ?? [])
    .filter((a) => abbr !== undefined && a.faculties.includes(abbr))
    .map((a) => a.code);
}

type FenceBase = { code: string; latitude: number; longitude: number; geoFenceMeters: number };

/** Cerca da base do plantão; se houver base alternativa, vale a mais próxima que acerta. */
export function checkGeofenceWithAlternates(
  lat: number, lng: number,
  base: FenceBase,
  alternates: FenceBase[],
): { valid: boolean; distance: number; geoFenceMeters: number; matchedBaseCode: string } {
  let best = {
    ...isWithinGeofence(lat, lng, base.latitude, base.longitude, base.geoFenceMeters),
    geoFenceMeters: base.geoFenceMeters,
    matchedBaseCode: base.code,
  };
  for (const alt of alternates) {
    const g = isWithinGeofence(lat, lng, alt.latitude, alt.longitude, alt.geoFenceMeters);
    if (g.valid && (!best.valid || g.distance < best.distance)) {
      best = { ...g, geoFenceMeters: alt.geoFenceMeters, matchedBaseCode: alt.code };
    }
  }
  return best;
}
