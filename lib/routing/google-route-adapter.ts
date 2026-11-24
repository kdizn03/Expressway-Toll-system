import { identifyExpressway } from "../toll/expressway-aliases";
import type { Coordinate, NormalizedRouteStep, RouteCandidate } from "./types";

/** Subset of the Routes API (v2 computeRoutes) response requested through the field mask. */
type LatLng = { latLng?: { latitude?: number; longitude?: number } };
export type GoogleRouteStep = {
  distanceMeters?: number;
  staticDuration?: string;
  navigationInstruction?: { maneuver?: string; instructions?: string };
  startLocation?: LatLng;
  endLocation?: LatLng;
};
export type GoogleRoute = { description?: string; distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string }; legs?: Array<{ steps?: GoogleRouteStep[] }> };
export type GoogleRoutesResponse = { routes?: GoogleRoute[] };

const seconds = (duration?: string) => duration ? Number.parseFloat(duration.replace("s", "")) || 0 : 0;
const coordinate = (location?: LatLng): Coordinate | undefined => {
  const point = location?.latLng;
  return point?.longitude !== undefined && point.latitude !== undefined ? [point.longitude, point.latitude] : undefined;
};

/** Decodes a Google encoded polyline (precision 5) into [longitude, latitude] pairs. */
export function decodePolyline(value = ""): Coordinate[] {
  const points: Coordinate[] = [];
  let index = 0; let latitude = 0; let longitude = 0;
  while (index < value.length) {
    let result = 0; let shift = 0; let byte: number;
    do { byte = value.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < value.length);
    latitude += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0; shift = 0;
    do { byte = value.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < value.length);
    longitude += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([longitude / 1e5, latitude / 1e5]);
  }
  return points;
}

/**
 * Extracts the road a Google step travels on from its instruction text.
 * Google has no per-step road-name field, so "Merge onto N Luzon Expy/E1 ⏎ Toll road"
 * must be parsed. Destination signage ("toward …", "signs for …") is ignored because it
 * names where the road leads, not the road being driven.
 */
export function parseInstruction(text = ""): { road?: string; tolled: boolean } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const tolled = lines.some((line) => /^(partial )?toll road$/i.test(line));
  const clean = (line: string) => line
    .replace(/\([^)]*\)/g, " ")
    .replace(/,?\s*(?:and )?(?:follow|following) signs? (?:for|to) .*$/i, "")
    .replace(/\s+toward(?:s)?\s+.*$/i, "")
    .replace(/\s+/g, " ").trim();
  const roadIn = (line: string) => {
    const value = clean(line);
    const onto = value.match(/\b(?:onto|on)\s+(?:the\s+)?(.+)$/i)?.[1];
    if (onto) return onto.replace(/^ramp (?:to|for)\s+/i, "").trim();
    const ramp = value.match(/\b(?:ramp|exit|slip road)\s+(?:to|for)\s+(.+)$/i)?.[1];
    if (ramp) return ramp.trim();
    const follow = value.match(/^continue to follow\s+(.+)$/i)?.[1];
    if (follow) return follow.trim();
    const named = value.match(/^take the (.+?) ramp$/i)?.[1];
    return named?.trim();
  };
  for (const line of lines.filter((line) => !/^(partial )?toll road$/i.test(line) && !/^pass by /i.test(line))) {
    const road = roadIn(line);
    if (road) return { road, tolled };
  }
  return { tolled };
}

/** TPLEX lies north and SCTEX south of the Tarlac City junction. */
const TPLEX_SCTEX_LATITUDE = 15.45;
/**
 * Hand-off between TPLEX and SCTEX. TPLEX traffic is charged to its La Paz plaza (the TPLEX
 * boundary used by the toll matcher) and enters SCTEX at its Tarlac plaza.
 */
const TPLEX_SIDE_OF_JUNCTION: Coordinate = [120.7284, 15.4408];
// SCTEX "Tarlac" plaza, location verified from OpenStreetMap booths (data/evidence/osm-toll-booths-2026-11-21.json).
const SCTEX_SIDE_OF_JUNCTION: Coordinate = [120.6758, 15.4628];
const junctionPoint = (code: string) => code === "TPLEX" ? TPLEX_SIDE_OF_JUNCTION : SCTEX_SIDE_OF_JUNCTION;

const routeNumbers = (road: string) => road.split("/").map((part) => part.trim().toUpperCase());

/**
 * Converts a Google road label into one the provider-independent expressway aliases
 * recognise. Google often labels toll roads only by route number (R-3, E6) or by the
 * shared "N Luzon W Expy" name, which covers both SCTEX and TPLEX.
 */
export function labelGoogleRoad(road: string, tolled: boolean, latitude: number): { name: string; ref?: string } | undefined {
  const numbers = routeNumbers(road);
  const ref = numbers.find((part) => /^E\d+$/.test(part));
  const normalised = road.toLowerCase();
  // SCTEX and TPLEX share the "N Luzon W Expy" label, and ramp signage near Clark names TPLEX.
  // They meet at Tarlac City (~15.45° N): TPLEX lies only north of it, SCTEX only south.
  const northWest = /\bn(orth)? luzon w(est)? exp/.test(normalised);
  const code = identifyExpressway(road);
  if (northWest || code === "TPLEX" || code === "SCTEX") return { name: latitude >= TPLEX_SCTEX_LATITUDE ? "TPLEX" : "SCTEX", ref };
  if (code) return { name: road, ref };
  if (ref === "E1") return { name: road, ref };
  if (ref === "E3") return { name: "CAVITEX", ref };
  if (ref === "E4") return { name: "SCTEX", ref };
  if (ref === "E5") return { name: "NLEX", ref };
  if (ref === "E6") return { name: "NAIAX", ref };
  if (!tolled) return undefined;
  // Radial-road numbers identify the expressway only on tolled stretches.
  if (numbers.includes("R-8")) return { name: road, ref: "E1" };
  if (numbers.includes("R-3")) return { name: "SLEX", ref };
  if (numbers.includes("R-1")) return { name: "CAVITEX", ref };
  return undefined;
}

const isExpresswayLabel = (label?: { name: string; ref?: string }) => Boolean(label && (identifyExpressway(label.name, label.ref) || label.ref === "E1"));

/** Turns Google steps into normalized steps, carrying the expressway through unnamed tolled steps. */
export function normalizeGoogleSteps(steps: GoogleRouteStep[]): NormalizedRouteStep[] {
  let current: { name: string; ref?: string } | undefined;
  return steps.flatMap((step) => {
    const start = coordinate(step.startLocation); const end = coordinate(step.endLocation);
    if (!start || !end) return [];
    const instruction = step.navigationInstruction?.instructions ?? "";
    const { road, tolled } = parseInstruction(instruction);
    const midLatitude = (start[1] + end[1]) / 2;
    const own = road ? labelGoogleRoad(road, tolled, midLatitude) : undefined;
    // An unnamed or unrecognised tolled step (a "Keep left" or a toll-road ramp) stays on the
    // expressway already being driven; an untolled one ends it.
    const label = isExpresswayLabel(own) ? own : tolled && current ? current : undefined;
    current = isExpresswayLabel(label) ? label : undefined;
    const base = { name: label?.name ?? road ?? "Unnamed road", ref: label?.ref, start, end, distanceMeters: step.distanceMeters ?? 0, durationSeconds: seconds(step.staticDuration), instruction, tolled };
    // Google reports TPLEX → SCTEX as one long step; split it at the Tarlac junction so both
    // expressways reach the toll engine (instead of charging the whole stretch as TPLEX).
    const code = label ? identifyExpressway(label.name) : undefined;
    const crossesJunction = (start[1] - TPLEX_SCTEX_LATITUDE) * (end[1] - TPLEX_SCTEX_LATITUDE) < 0;
    if ((code === "TPLEX" || code === "SCTEX") && crossesJunction) {
      const share = Math.min(1, Math.max(0, Math.abs(start[1] - TPLEX_SCTEX_LATITUDE) / Math.abs(start[1] - end[1])));
      const side = (latitude: number) => latitude >= TPLEX_SCTEX_LATITUDE ? "TPLEX" : "SCTEX";
      const first = side(start[1]); const second = side(end[1]);
      current = { name: second, ref: label?.ref };
      return [
        { ...base, name: first, end: junctionPoint(first), distanceMeters: base.distanceMeters * share, durationSeconds: base.durationSeconds * share },
        { ...base, name: second, start: junctionPoint(second), distanceMeters: base.distanceMeters * (1 - share), durationSeconds: base.durationSeconds * (1 - share) },
      ];
    }
    return [base];
  });
}

/** GoogleRouteAdapter: Routes API response → provider-neutral RouteCandidate list. */
export function normalizeGoogleRoutes(body: GoogleRoutesResponse, avoidTolls = false): RouteCandidate[] {
  return (body.routes ?? []).flatMap((route, index) => {
    const coordinates = decodePolyline(route.polyline?.encodedPolyline);
    if (coordinates.length < 2) return [];
    const steps = normalizeGoogleSteps((route.legs ?? []).flatMap((leg) => leg.steps ?? []));
    return [{ id: `${avoidTolls ? "google-avoid" : "google-drive"}-${index}`, distanceMeters: route.distanceMeters ?? 0, durationSeconds: seconds(route.duration), geometry: { type: "LineString" as const, coordinates }, steps, provider: "google" as const, encodedPolyline: route.polyline?.encodedPolyline, summary: route.description }];
  });
}
