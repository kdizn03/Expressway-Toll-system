import { isInLuzonCoverage } from "../geo/luzon";
import { KM_PER_DEG_LAT, kmPerDegLng, type LngLat } from "../geo/polygon";

/**
 * Pure logic for verifying toll plaza locations against named toll booths from OpenStreetMap
 * (barrier=toll_booth) and an expressway corridor (the road's line). No I/O here; see
 * scripts/verify-plaza-locators.ts for the data loading and lib/toll-data/plaza-corrections.ts for writes.
 */
export type Booth = { osm: string; lat: number; lon: number; name: string; operator?: string };
export type Corridor = LngLat[][]; // polylines of the expressway's own road

const STRIP_WORDS = /\b(toll|plaza|gate|northbound|southbound|eastbound|westbound|entry|exit|entrance|interchange|city|barrier)\b/g;
/** Normalises plaza names so "Santo Tomas", "Sto. Tomas" and "Batangas City Toll Plaza" / "Batangas" compare equal. */
export function normalizePlazaName(name: string) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
    .replace(/\bsanto\b/g, "sto").replace(/\bsanta\b/g, "sta").replace(/\bavenue\b/g, "ave").replace(/\bboulevard\b/g, "blvd").replace(/\broad\b/g, "rd")
    .replace(STRIP_WORDS, " ").replace(/\s+[ab]$/, " ").replace(/\s+/g, " ").trim();
}

/** A rated name such as "Bacoor/Zapote" also identifies booths named after either part. */
export function nameKeys(name: string) {
  const keys = new Set([normalizePlazaName(name)]);
  for (const part of name.split("/")) { const key = normalizePlazaName(part); if (key.length >= 3) keys.add(key); }
  keys.delete("");
  return keys;
}

export function distanceKm(a: LngLat, b: LngLat) {
  return Math.hypot((a[0] - b[0]) * kmPerDegLng((a[1] + b[1]) / 2), (a[1] - b[1]) * KM_PER_DEG_LAT);
}

/** Shortest distance from a point to any polyline of the corridor (km). */
export function distanceToCorridorKm(point: LngLat, corridor: Corridor) {
  let best = Infinity; const kx = kmPerDegLng(point[1]);
  for (const line of corridor) for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - point[0]) * kx, ay = (line[i - 1][1] - point[1]) * KM_PER_DEG_LAT;
    const bx = (line[i][0] - point[0]) * kx, by = (line[i][1] - point[1]) * KM_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay; const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Distance along the corridor's longest line to the point's closest position (km); used to order plazas. */
export function positionAlongCorridorKm(point: LngLat, corridor: Corridor) {
  const line = [...corridor].sort((a, b) => b.length - a.length)[0] ?? [];
  let travelled = 0; let best = { distance: Infinity, along: 0 }; const kx = kmPerDegLng(point[1]);
  for (let i = 1; i < line.length; i++) {
    const segment = distanceKm(line[i - 1], line[i]);
    const ax = (line[i - 1][0] - point[0]) * kx, ay = (line[i - 1][1] - point[1]) * KM_PER_DEG_LAT;
    const bx = (line[i][0] - point[0]) * kx, by = (line[i][1] - point[1]) * KM_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay; const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
    const distance = Math.hypot(ax + t * dx, ay + t * dy);
    if (distance < best.distance) best = { distance, along: travelled + t * segment };
    travelled += segment;
  }
  return best.along;
}

export type PlazaVerificationResult =
  | { status: "VERIFIED_GEODATA"; coordinate: LngLat; booths: Booth[]; maxCorridorKm: number; spreadKm: number }
  | { status: "NEEDS_REVIEW" | "UNRESOLVED"; reason: string; candidates: Booth[] };

export const MAX_BOOTH_TO_ROAD_KM = 1.0;
export const MAX_BOOTH_SPREAD_KM = 2.0;

/**
 * Verifies one rated plaza name for one expressway. A location is accepted only when
 * (1) OSM booths have a normalised name equal to the plaza name (or one part of a "A/B" name),
 * (2) none carries a conflicting operator, (3) every accepted booth lies within 1 km of the
 * expressway's own road, (4) the booths form one cluster (≤ 2 km spread), and (5) it is on Luzon.
 * The coordinate is the mean of the accepted booths (both directions of a plaza).
 */
export function verifyPlaza(name: string, booths: Booth[], corridor: Corridor, operatorAllowed: (operator: string | undefined) => boolean): PlazaVerificationResult {
  const keys = nameKeys(name);
  const named = booths.filter((booth) => keys.has(normalizePlazaName(booth.name)));
  if (named.length === 0) return { status: "UNRESOLVED", reason: "No OpenStreetMap toll booth has this name.", candidates: [] };
  const operatorOk = named.filter((booth) => operatorAllowed(booth.operator));
  if (operatorOk.length === 0) return { status: "NEEDS_REVIEW", reason: "Named booths belong to a different operator.", candidates: named };
  if (corridor.length === 0) return { status: "NEEDS_REVIEW", reason: "No road line available for this expressway.", candidates: operatorOk };
  const onRoad = operatorOk.filter((booth) => distanceToCorridorKm([booth.lon, booth.lat], corridor) <= MAX_BOOTH_TO_ROAD_KM);
  if (onRoad.length === 0) return { status: "NEEDS_REVIEW", reason: `Named booths are more than ${MAX_BOOTH_TO_ROAD_KM} km from this expressway.`, candidates: operatorOk };
  const coordinate: LngLat = [onRoad.reduce((sum, booth) => sum + booth.lon, 0) / onRoad.length, onRoad.reduce((sum, booth) => sum + booth.lat, 0) / onRoad.length];
  const spreadKm = Math.max(...onRoad.map((booth) => distanceKm([booth.lon, booth.lat], coordinate)));
  if (spreadKm > MAX_BOOTH_SPREAD_KM) return { status: "NEEDS_REVIEW", reason: `Booths with this name are ${spreadKm.toFixed(1)} km apart; more than one plaza may share the name.`, candidates: onRoad };
  if (!isInLuzonCoverage(coordinate)) return { status: "NEEDS_REVIEW", reason: "Resulting location is outside Luzon coverage.", candidates: onRoad };
  const rounded: LngLat = [Math.round(coordinate[0] * 1e6) / 1e6, Math.round(coordinate[1] * 1e6) / 1e6];
  return { status: "VERIFIED_GEODATA", coordinate: rounded, booths: onRoad, maxCorridorKm: Math.max(...onRoad.map((booth) => distanceToCorridorKm([booth.lon, booth.lat], corridor))), spreadKm };
}

/**
 * Judges a stored locator that could not be verified. "invalid" (off Luzon, or stacked on one point with
 * other plazas by a failed geocode) is hard evidence and the record is deactivated. "review" (far from a
 * road line that may itself be incomplete) only flags the record; it stays in use.
 */
export function suspectReason(plaza: { latitude: number; longitude: number }, stackedCount: number, corridor: Corridor): { reason: string; severity: "invalid" | "review" } | undefined {
  const point: LngLat = [plaza.longitude, plaza.latitude];
  if (!isInLuzonCoverage(point)) return { reason: "Stored location is outside Luzon.", severity: "invalid" };
  if (stackedCount > 2) return { reason: `Stored location is shared with ${stackedCount - 1} other plazas (a failed geocode).`, severity: "invalid" };
  if (corridor.length > 0) { const distance = distanceToCorridorKm(point, corridor); if (distance > 3) return { reason: `Stored location is ${distance.toFixed(1)} km from the expressway line used for checking; needs review.`, severity: "review" }; }
  return undefined;
}
