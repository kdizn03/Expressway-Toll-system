import { prisma } from "@/lib/db";
import { identifyExpressway } from "./expressway-aliases";
import type { MatchedRoad } from "./calculation-service";
import type { RouteCandidate } from "@/lib/routing/types";
import { matchedEntryName } from "./tplex-entry";
import { nlexBoundaryPlazas, skywayStage3BoundaryPlazas } from "./nlex-boundary";
import { usablePlazas } from "./plaza-coverage";
import { skywayStageSplit } from "./skyway-stages";
import { continueAtHandover } from "./route-matcher-handover";

const distanceMeters = ([lngA, latA]: [number, number], [lngB, latB]: [number, number]) => {
  const r = 6371000; const dLat = (latB - latA) * Math.PI / 180; const dLng = (lngB - lngA) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(latA * Math.PI / 180) * Math.cos(latB * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** Maps route steps to plaza pairs only within the detected expressway. No global-nearest shortcut. */
export async function matchRouteToTolls(route: RouteCandidate): Promise<MatchedRoad[]> {
  const grouped = new Map<string, { start: [number, number]; end: [number, number]; tolled: boolean }>();
  // `tolled` is undefined when the provider does not report toll status; treat that as tolled.
  let stepTolled = true;
  // Sections are contiguous runs: returning to an expressway after driving another one (e.g. at-grade SLEX →
  // Skyway → SLEX) starts a new section, so separately charged stretches are never merged into one trip.
  let lastCode: string | undefined; const runs = new Map<string, number>();
  const add = (code: string, start: [number, number], end: [number, number]) => {
    if (code !== lastCode) runs.set(code, (runs.get(code) ?? 0) + 1);
    lastCode = code;
    const key = runs.get(code)! > 1 ? `${code}#run${runs.get(code)}` : code;
    const found = grouped.get(key); grouped.set(key, found ? { start: found.start, end, tolled: found.tolled || stepTolled } : { start, end, tolled: stepTolled });
  };
  for (const step of route.steps) {
    stepTolled = step.tolled !== false;
    const code = identifyExpressway(step.name, step.ref);
    if (code) { add(code, step.start, step.end); continue; }
    // Providers occasionally report E1 without its NLEX/TPLEX road name. Split
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
  // Skyway Stage 3 (north of Buendia) and Stages 1–2 (south of it) are separately priced systems.
  for (const [key, section] of [...grouped]) {
    if (key.split("#")[0] !== "SKYWAY") continue;
    const split = skywayStageSplit(section.start, section.end);
    if (!split) continue;
    // Rebuild the map so the two Skyway parts keep their place in the route order.
    const entries = [...grouped].flatMap(([k, v]) => k === key ? [[k, { ...v, end: split.boundary }], [`${k}#stage12`, { ...v, start: split.boundary }]] as Array<[string, typeof v]> : [[k, v] as [string, typeof v]]);
    grouped.clear(); for (const [k, v] of entries) grouped.set(k, v);
  }
  const matches: MatchedRoad[] = [];
  for (const [groupKey, section] of grouped) {
    const expressway = groupKey.split("#")[0];
    let plazas: Awaited<ReturnType<typeof prisma.tollPlaza.findMany>>;
    try { plazas = usablePlazas(await prisma.tollPlaza.findMany({ where: { expressway: { abbreviation: expressway }, active: true } })); }
    catch { matches.push({ expressway, entry: "plaza data unavailable", exit: "plaza data unavailable", confidence: "LOW" }); continue; }
    const nearest = (point: [number, number]) => plazas.map((plaza) => ({ plaza, distance: distanceMeters(point, [plaza.longitude, plaza.latitude]) })).sort((a, b) => a.distance - b.distance)[0];
    const entry = nearest(section.start), exit = nearest(section.end);
    // Keep an unresolved segment visible rather than silently omitting it.
    // A toll-free stretch of a named expressway (e.g. at-grade SLEX) that crosses no plaza and that
    // the provider reports as untolled is not a toll segment.
    if (entry && exit && entry.plaza.id === exit.plaza.id && !section.tolled) continue;
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
  return continueAtHandover(matches, await handoverNames());
}

/** Plaza names that exist on both Skyway and SLEX (shared interchanges such as Alabang). */
async function handoverNames() {
  try {
    const plazas = await prisma.tollPlaza.findMany({ where: { active: true, expressway: { abbreviation: { in: ["SKYWAY", "SLEX"] } } }, select: { name: true, expressway: { select: { abbreviation: true } } } });
    const skyway = new Set(plazas.filter((plaza) => plaza.expressway.abbreviation === "SKYWAY").map((plaza) => plaza.name));
    return new Set(plazas.filter((plaza) => plaza.expressway.abbreviation === "SLEX" && skyway.has(plaza.name)).map((plaza) => plaza.name));
  } catch { return new Set<string>(); }
}
