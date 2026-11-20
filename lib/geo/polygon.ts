/** Small, dependency-free polygon helpers shared by the Philippine and Luzon boundary checks. */
export type LngLat = [longitude: number, latitude: number];
export type Ring = { points: LngLat[]; minLng: number; minLat: number; maxLng: number; maxLat: number };

export const KM_PER_DEG_LAT = 110.57;
export const kmPerDegLng = (latitude: number) => 111.32 * Math.cos(latitude * Math.PI / 180);

export const isLngLat = (value: unknown): value is LngLat => Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;

export function toRing(points: LngLat[]): Ring {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of points) { minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); }
  return { points, minLng, minLat, maxLng, maxLat };
}

/** Ray-casting point-in-polygon with a bounding-box shortcut. */
export function insideRing([lng, lat]: LngLat, ring: Ring) {
  if (lng < ring.minLng || lng > ring.maxLng || lat < ring.minLat || lat > ring.maxLat) return false;
  let inside = false; const points = ring.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]; const [xj, yj] = points[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the point's bounding-box distance to the ring could be within `km`. */
export function nearRingBox([lng, lat]: LngLat, ring: Ring, km: number) {
  const padLat = km / KM_PER_DEG_LAT; const padLng = km / Math.max(1, kmPerDegLng(lat));
  return lng >= ring.minLng - padLng && lng <= ring.maxLng + padLng && lat >= ring.minLat - padLat && lat <= ring.maxLat + padLat;
}

/** Shortest distance (km) from a point to a ring's edges, using a local equirectangular projection. */
export function distanceToRingKm([lng, lat]: LngLat, ring: Ring, limitKm = Infinity) {
  const kx = kmPerDegLng(lat); let best = limitKm;
  const points = ring.points;
  for (let i = 1; i < points.length; i++) {
    const ax = (points[i - 1][0] - lng) * kx, ay = (points[i - 1][1] - lat) * KM_PER_DEG_LAT;
    const bx = (points[i][0] - lng) * kx, by = (points[i][1] - lat) * KM_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay; const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/**
 * Returns the first point along a line (vertices sampled about every `sampleKm`, and long straight
 * segments checked along their length) for which `accept` is false, or undefined if all pass.
 */
export function firstRejectedPoint(coordinates: LngLat[], accept: (point: LngLat) => boolean, sampleKm = 1): LngLat | undefined {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return undefined;
  let sinceLast = Infinity; let previous: LngLat | undefined;
  for (let index = 0; index < coordinates.length; index++) {
    const point = coordinates[index];
    if (!isLngLat(point)) return point;
    if (previous) {
      const segmentKm = Math.hypot((point[0] - previous[0]) * kmPerDegLng(point[1]), (point[1] - previous[1]) * KM_PER_DEG_LAT);
      for (let step = 1; step * sampleKm < segmentKm; step++) {
        const t = step * sampleKm / segmentKm;
        const between: LngLat = [previous[0] + (point[0] - previous[0]) * t, previous[1] + (point[1] - previous[1]) * t];
        if (!accept(between)) return between;
      }
      sinceLast += segmentKm;
    }
    previous = point;
    if (sinceLast >= sampleKm || index === coordinates.length - 1) {
      sinceLast = 0;
      if (!accept(point)) return point;
    }
  }
  return undefined;
}
