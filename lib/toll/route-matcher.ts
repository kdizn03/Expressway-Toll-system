import { prisma } from "@/lib/db";
import { identifyExpressway } from "./expressway-aliases";
import type { MatchedRoad } from "./calculation-service";
import type { RouteCandidate } from "@/lib/routing/types";
import { matchedEntryName } from "./tplex-entry";
import { nlexBoundaryPlazas, skywayStage3BoundaryPlazas } from "./nlex-boundary";

const distanceMeters = ([lngA, latA]: [number, number], [lngB, latB]: [number, number]) => {
  const r = 6371000; const dLat = (latB - latA) * Math.PI / 180; const dLng = (lngB - lngA) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(latA * Math.PI / 180) * Math.cos(latB * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** Maps route steps to plaza pairs only within the detected expressway. No global-nearest shortcut. */
export async function matchRouteToTolls(route: RouteCandidate): Promise<MatchedRoad[]> {
  const grouped = new Map<string, { start: [number, number]; end: [number, number] }>();
  const add = (code: string, start: [number, number], end: [number, number]) => { const found = grouped.get(code); grouped.set(code, found ? { start: found.start, end } : { start, end }); };
  for (const step of route.steps) {
    const code = identifyExpressway(step.name, step.ref);
    if (code) { add(code, step.start, step.end); continue; }
    // Mapbox occasionally reports E1 without its NLEX/TPLEX road name. Split
    // a cross-boundary E1 step at the physical La Paz/Sta. Ines hand-off.
    if (step.ref !== "E1") continue;
    const southbound = step.end[1] < step.start[1];
    const crossesBoundary = (step.start[1] > 15.3 && step.end[1] < 15.3) || (step.start[1] < 15.3 && step.end[1] > 15.3);
    if (crossesBoundary) {
      const tplexBoundary: [number, number] = [120.7284, 15.4408];
      const nlexBoundary: [number, number] = [120.59, 15.215];
      if (southbound) { add("TPLEX", step.start, tplexBoundary); add("NLEX", nlexBoundary, step.end); }
      else { add("NLEX", step.start, nlexBoundary); add("TPLEX", tplexBoundary, step.end); }
    } else add(step.start[1] >= 15.3 ? "TPLEX" : "NLEX", step.start, step.end);
  }
  const matches: MatchedRoad[] = [];
  for (const [expressway, section] of grouped) {
    let plazas: Awaited<ReturnType<typeof prisma.tollPlaza.findMany>>;
    try { plazas = await prisma.tollPlaza.findMany({ where: { expressway: { abbreviation: expressway } } }); }
    catch { matches.push({ expressway, entry: "plaza data unavailable", exit: "plaza data unavailable", confidence: "LOW" }); continue; }
    const nearest = (point: [number, number]) => plazas.map((plaza) => ({ plaza, distance: distanceMeters(point, [plaza.longitude, plaza.latitude]) })).sort((a, b) => a.distance - b.distance)[0];
    const entry = nearest(section.start), exit = nearest(section.end);
    // Keep an unresolved segment visible rather than silently omitting it.
    if (!entry || !exit || entry.plaza.id === exit.plaza.id) {
      matches.push({ expressway, entry: entry?.plaza.name ?? "unresolved entry", exit: exit?.plaza.name ?? "unresolved exit", confidence: "LOW" });
      continue;
    }
    // Map providers often begin the first TPLEX-labelled step after the
    // Rosario toll entry for traffic arriving from Baguio/La Union. Preserve
    // the actual northern entry rather than charging the next internal plaza.
    const tplexEntry = matchedEntryName(expressway, route.geometry.coordinates[0]?.[1], section.start[1], section.end[1], entry.plaza.name);
    const nlex = expressway === "NLEX" ? nlexBoundaryPlazas(route.geometry.coordinates[0]?.[1], route.geometry.coordinates.at(-1)?.[1], section.start[1], section.end[1], entry.plaza.name, exit.plaza.name) : undefined;
    const skyway = expressway === "SKYWAY" ? skywayStage3BoundaryPlazas(route.geometry.coordinates[0]?.[1], section.start[1], section.end[1], entry.plaza.name, exit.plaza.name) : undefined;
    const entryName = skyway?.entry ?? nlex?.entry ?? tplexEntry;
    const exitName = skyway?.exit ?? nlex?.exit ?? exit.plaza.name;
    const confidence = entry.distance <= 2000 && exit.distance <= 2000 ? "HIGH" : entry.distance <= 8000 && exit.distance <= 8000 ? "MEDIUM" : "LOW";
    matches.push({ expressway, entry: entryName, exit: exitName, confidence });
  }
  return matches;
}
