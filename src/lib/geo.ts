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
