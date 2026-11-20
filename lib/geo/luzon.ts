import coverage from "./luzon-coverage.json";
import { distanceToRingKm, firstRejectedPoint, insideRing, isLngLat, nearRingBox, toRing, type LngLat } from "./polygon";

/**
 * Supported coverage: the Luzon main island, where the whole supported expressway network
 * (NLEX, SCTEX, TPLEX, SLEX, Skyway, STAR, CAVITEX, CALAX, NAIAX, …) lies and which is reachable
 * by road without a ferry. It is the Natural Earth 1:10m Luzon polygon plus a 3 km coastal
 * tolerance (reclaimed waterfronts such as the Mall of Asia complex, Subic port). Separate islands —
 * Mindoro, Marinduque, Catanduanes, Polillo, Alabat, Corregidor, Batanes, and all of the Visayas
 * and Mindanao — are outside coverage, even when they belong to the Luzon island group.
 * This module is used identically in the browser (autocomplete selections) and on the server.
 */
export const LUZON_COASTAL_TOLERANCE_KM = 3;

const luzon = toRing(coverage.luzon as LngLat[]);
const nearbyIslands = (coverage.nearbyIslands as LngLat[][]).map(toRing);

/** Rectangle around the coverage polygon; only used to restrict/bias search requests, never as the validation itself. */
export const LUZON_SEARCH_BOUNDS = { south: luzon.minLat - 0.05, west: luzon.minLng - 0.05, north: luzon.maxLat + 0.05, east: luzon.maxLng + 0.05 };

/** True when the point is on the Luzon main island (or within the coastal tolerance of it, but not on another island). */
export function isInLuzonCoverage(point: LngLat, toleranceKm = LUZON_COASTAL_TOLERANCE_KM): boolean {
  if (!isLngLat(point) || !nearRingBox(point, luzon, toleranceKm)) return false;
  if (insideRing(point, luzon)) return true;
  if (nearbyIslands.some((island) => insideRing(point, island))) return false;
  return distanceToRingKm(point, luzon, toleranceKm + 1) <= toleranceKm;
}

/** First sampled route point outside Luzon coverage, or undefined when the route stays inside. */
export function firstPointOutsideLuzon(coordinates: LngLat[], sampleKm = 1): LngLat | undefined {
  return firstRejectedPoint(coordinates, (point) => isInLuzonCoverage(point), sampleKm);
}

/** True when a route geometry has at least two valid points and never leaves Luzon coverage. */
export function routeStaysInLuzon(geometry: { coordinates: LngLat[] } | undefined): boolean {
  const coordinates = geometry?.coordinates;
  return Array.isArray(coordinates) && coordinates.length >= 2 && firstPointOutsideLuzon(coordinates) === undefined;
}
