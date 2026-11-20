import boundary from "./philippines-boundary.json";
import { distanceToRingKm, firstRejectedPoint, insideRing, isLngLat, nearRingBox, toRing, type LngLat, type Ring } from "./polygon";

export type { LngLat } from "./polygon";

/**
 * Philippine territory check built on Natural Earth 1:10m Admin-0 land polygons (public
 * domain, see lib/geo/README.md). A point counts as Philippine when it lies on Philippine
 * land or within the 12-nautical-mile territorial sea of it. In this dataset the nearest
 * foreign land (an islet off Sabah) is 36.5 km from Philippine land, so the buffer never
 * reaches another country.
 */
export const PH_TERRITORIAL_SEA_KM = 22.2;

const rings: Ring[] = (boundary.rings as LngLat[][]).map(toRing);
const extent = toRing(rings.flatMap((ring) => [[ring.minLng, ring.minLat], [ring.maxLng, ring.maxLat]] as LngLat[]));

/** Distance in km from a point to Philippine land (0 on land). Returns Infinity beyond `searchKm`. */
export function distanceToPhilippinesKm(point: LngLat, searchKm = PH_TERRITORIAL_SEA_KM): number {
  if (!isLngLat(point) || !nearRingBox(point, extent, searchKm)) return Infinity;
  if (rings.some((ring) => insideRing(point, ring))) return 0;
  let best = Infinity;
  for (const ring of rings) if (nearRingBox(point, ring, searchKm)) best = Math.min(best, distanceToRingKm(point, ring, Math.min(best, searchKm + 1)));
  return best <= searchKm ? best : Infinity;
}

/** True when the point is on Philippine land or within its territorial sea. */
export function isInPhilippines(point: LngLat, toleranceKm = PH_TERRITORIAL_SEA_KM): boolean {
  return distanceToPhilippinesKm(point, toleranceKm) <= toleranceKm;
}

// Inter-island ferry legs cross archipelagic waters (Sibuyan, Visayan, Mindanao seas) that can lie
// farther than 22.2 km from the generalised coastline. Routes therefore also accept points inside the
// archipelago's convex hull, except on foreign land the hull overlaps (north-eastern Sabah).
const hull = boundary.archipelagoHull as LngLat[];
const foreignLandInHull: Ring[] = (boundary.foreignLandInHull as Array<{ country: string; ring: LngLat[] }>).map(({ ring }) => toRing(ring));
const insideHull = ([lng, lat]: LngLat) => hull.every((a, index) => {
  const b = hull[(index + 1) % hull.length];
  return (b[0] - a[0]) * (lat - a[1]) - (b[1] - a[1]) * (lng - a[0]) >= 0;
});

/** True when a route point is in Philippine territory: land, territorial sea, or archipelagic waters. */
export function isOnPhilippineRoute(point: LngLat, toleranceKm = PH_TERRITORIAL_SEA_KM): boolean {
  if (!isLngLat(point)) return false;
  if (insideHull(point)) return !foreignLandInHull.some((ring) => insideRing(point, ring));
  return isInPhilippines(point, toleranceKm);
}

/** First sampled route point outside Philippine territory, or undefined when the route stays inside. */
export function firstPointOutsidePhilippines(coordinates: LngLat[], sampleKm = 1, toleranceKm = PH_TERRITORIAL_SEA_KM): LngLat | undefined {
  return firstRejectedPoint(coordinates, (point) => isOnPhilippineRoute(point, toleranceKm), sampleKm);
}

/** True when a route geometry has at least two valid points and never leaves Philippine territory. */
export function routeStaysInPhilippines(geometry: { coordinates: LngLat[] } | undefined): boolean {
  const coordinates = geometry?.coordinates;
  return Array.isArray(coordinates) && coordinates.length >= 2 && firstPointOutsidePhilippines(coordinates) === undefined;
}

export const philippineBoundarySource = { source: boundary.source, sourceUrl: boundary.sourceUrl };
