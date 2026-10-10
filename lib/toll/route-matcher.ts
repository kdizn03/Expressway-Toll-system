import { prisma } from "@/lib/db";
import { identifyExpressway } from "./expressway-aliases";
import type { MatchedRoad } from "./calculation-service";
import type { RouteCandidate } from "@/lib/routing/mapbox";
import { ensurePlazasForExpressways } from "@/lib/toll-import/plaza-enrichment.js";

const distanceMeters = ([lngA, latA]: [number, number], [lngB, latB]: [number, number]) => {
  const r = 6371000; const dLat = (latB - latA) * Math.PI / 180; const dLng = (lngB - lngA) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(latA * Math.PI / 180) * Math.cos(latB * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** Maps route steps to plaza pairs only within the detected expressway. No global-nearest shortcut. */
export async function matchRouteToTolls(route: RouteCandidate): Promise<MatchedRoad[]> {
  const grouped = new Map<string, { start: [number, number]; end: [number, number] }>();
  for (const step of route.steps) { const code = identifyExpressway(step.name, step.ref); if (!code) continue; const found = grouped.get(code); grouped.set(code, found ? { start: found.start, end: step.end } : { start: step.start, end: step.end }); }
  try { await ensurePlazasForExpressways(prisma, [...grouped.keys()]); } catch { /* Matching still works with plazas already in the database. */ }
  const matches: MatchedRoad[] = [];
  for (const [expressway, section] of grouped) {
    let plazas: Awaited<ReturnType<typeof prisma.tollPlaza.findMany>>;
    try { plazas = await prisma.tollPlaza.findMany({ where: { expressway: { abbreviation: expressway } } }); }
    catch { matches.push({ expressway, entry: "plaza data unavailable", exit: "plaza data unavailable", confidence: "LOW" }); continue; }
    const nearest = (point: [number, number]) => plazas.map((plaza) => ({ plaza, distance: distanceMeters(point, [plaza.longitude, plaza.latitude]) })).sort((a, b) => a.distance - b.distance)[0];
    const entry = nearest(section.start), exit = nearest(section.end);
    // A single nearest plaza does not identify a chargeable entry/exit pair.
    // Do not turn it into a made-up missing-fee segment that hides other fees.
    if (!entry || !exit || entry.plaza.id === exit.plaza.id) continue;
    const confidence = entry.distance <= 2000 && exit.distance <= 2000 ? "HIGH" : entry.distance <= 8000 && exit.distance <= 8000 ? "MEDIUM" : "LOW";
    matches.push({ expressway, entry: entry.plaza.name, exit: exit.plaza.name, confidence });
  }
  return matches;
}
