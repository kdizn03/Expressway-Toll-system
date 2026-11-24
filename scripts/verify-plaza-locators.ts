/**
 * Verifies toll plaza locations and proposes corrections.
 *
 *   npx tsx --env-file=.env scripts/verify-plaza-locators.ts            # dry run: writes a report only
 *   npx tsx --env-file=.env scripts/verify-plaza-locators.ts --apply    # applies the plan in one transaction
 *
 * Evidence: named OpenStreetMap toll booths (data/evidence/osm-toll-booths-*.json, ODbL) supply the
 * coordinates. Google Routes is used only to obtain each expressway's road line, so a booth is accepted
 * only if it sits on that expressway. Google route geometry is not stored.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { decodePolyline, normalizeGoogleSteps, type GoogleRouteStep } from "../lib/routing/google-route-adapter";
import { identifyExpressway } from "../lib/toll/expressway-aliases";
import { canonicalMatrixPlaza } from "../lib/toll/plaza-name";
import { toAppExpresswayCode } from "../lib/toll-import/expressway-code.js";
import { distanceKm, nameKeys, normalizePlazaName, positionAlongCorridorKm, suspectReason, verifyPlaza, type Booth, type Corridor } from "../lib/toll-data/plaza-verification";
import { applyPlazaPlan, type PlazaPlanOperation } from "../lib/toll-data/plaza-corrections";
import type { LngLat } from "../lib/geo/polygon";

const EVIDENCE = "data/evidence/osm-toll-booths-2026-11-21.json";
const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

// Points are [lat, lng] of named OSM booths or interchanges on each expressway.
type LatLng = [number, number];
const corridorsToBuild: Record<string, Array<{ from: LatLng; to: LatLng; via?: LatLng[] }>> = {
  NLEX: [{ from: [14.6795, 121.0001], to: [15.2218, 120.5884] }],
  SCTEX: [{ from: [14.8420, 120.3540], to: [15.2290, 120.5610] }, { from: [15.2290, 120.5610], to: [15.4630, 120.6760] }],
  TPLEX: [{ from: [15.4700, 120.6000], to: [16.2180, 120.4980] }, { from: [15.4410, 120.7280], to: [15.5700, 120.6200] }],
  SLEX: [{ from: [14.5400, 121.0180], to: [14.1270, 121.1380], via: [[14.4880, 121.0440]] }],
  SKYWAY: [{ from: [14.6570, 120.9980], to: [14.4290, 121.0450] }],
  STAR: [{ from: [14.1270, 121.1380], to: [13.7970, 121.0770] }],
  CALAX: [{ from: [14.2920, 121.0680], to: [14.2550, 120.9760] }, { from: [14.2550, 120.9760], to: [14.2930, 120.9270] }],
  CAVITEX: [{ from: [14.5340, 120.9925], to: [14.4543, 120.9170] }, { from: [14.4930, 120.9870], to: [14.5140, 121.0340] }],
  NAIAX: [{ from: [14.5350, 120.9890], to: [14.5200, 121.0150] }],
  NLEX_CONNECTOR: [{ from: [14.6416, 120.9629], to: [14.6010, 121.0185] }, { from: [14.6795, 121.0001], to: [14.6010, 121.0185] }],
  MCX: [{ from: [14.3780, 121.0000], to: [14.3760, 121.0300] }],
};
// Names listed under these codes may physically be plazas of this expressway (verified by road line).
const integratedNames: Record<string, string[]> = { SLEX: ["SKYWAY", "STAR"] };
// OSM operator tags that may appear on each expressway's booths (booths with no operator tag are allowed).
const operators: Record<string, RegExp> = {
  NLEX: /nlex|metro pacific/i, SCTEX: /nlex|metro pacific|bcda/i, TPLEX: /tplex|private infra|pidc/i, NLEX_CONNECTOR: /nlex|metro pacific/i,
  SLEX: /south luzon|manila toll|smc|slex/i, SKYWAY: /skyway|south luzon|manila toll|smc/i, STAR: /star|smc|south luzon/i, MCX: /mcx|ayala|smc/i,
  NAIAX: /naia|smc/i, CAVITEX: /cavitex|peatc|metro pacific|cavite/i, CALAX: /mpcala|calax|metro pacific/i,
};

async function buildCorridor(code: string): Promise<Corridor> {
  const key = process.env.GOOGLE_MAPS_SERVER_API_KEY; if (!key) throw new Error("GOOGLE_MAPS_SERVER_API_KEY is required.");
  const lines: Corridor = [];
  for (const { from, to, via } of corridorsToBuild[code] ?? []) {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction,routes.legs.steps.startLocation,routes.legs.steps.endLocation,routes.legs.steps.distanceMeters" },
      body: JSON.stringify({ origin: { location: { latLng: { latitude: from[0], longitude: from[1] } } }, destination: { location: { latLng: { latitude: to[0], longitude: to[1] } } }, intermediates: (via ?? []).map(([latitude, longitude]) => ({ via: true, location: { latLng: { latitude, longitude } } })), travelMode: "DRIVE", languageCode: "en-US", regionCode: "PH" }),
    });
    if (!response.ok) throw new Error(`Routes API ${response.status} while building the ${code} corridor.`);
    const body = await response.json() as { routes?: Array<{ polyline?: { encodedPolyline?: string }; legs?: Array<{ steps?: GoogleRouteStep[] }> }> };
    const route = body.routes?.[0]; if (!route) continue;
    const points = decodePolyline(route.polyline?.encodedPolyline);
    const steps = normalizeGoogleSteps((route.legs ?? []).flatMap((leg) => leg.steps ?? []));
    // Walk the route line once, assigning each stretch to the step whose start/end it spans.
    let cursor = 0;
    const nearestFrom = (point: LngLat, start: number) => { let best = start; let bestDistance = Infinity; for (let i = start; i < points.length; i++) { const d = distanceKm(points[i], point); if (d < bestDistance) { bestDistance = d; best = i; } if (d > bestDistance + 5) break; } return best; };
    for (const step of steps) {
      const startIndex = nearestFrom(step.start, cursor); const endIndex = nearestFrom(step.end, startIndex);
      const stepCode = identifyExpressway(step.name, step.ref) ?? (step.ref === "E1" ? (step.start[1] >= 15.3 ? "TPLEX" : "NLEX") : undefined);
      if (stepCode === code && endIndex > startIndex) lines.push(points.slice(startIndex, endIndex + 1));
      cursor = Math.max(cursor, startIndex);
    }
  }
  return lines;
}

type ExistingPlaza = { id: string; name: string; latitude: number; longitude: number; aliases: unknown; expresswayId: string; verificationStatus: string; _count: { entryRates: number; exitRates: number } };

async function main() {
  const evidence = JSON.parse(readFileSync(EVIDENCE, "utf8")) as { booths: Booth[] };
  const expressways = await prisma.expressway.findMany({ select: { id: true, abbreviation: true } });
  const plazas: ExistingPlaza[] = await prisma.tollPlaza.findMany({ select: { id: true, name: true, latitude: true, longitude: true, aliases: true, expresswayId: true, verificationStatus: true, _count: { select: { entryRates: true, exitRates: true } } } });
  const rows = await prisma.matrixImportRow.findMany({ where: { matrixImport: { status: "PUBLISHED" } }, select: { entryExpresswayCode: true, exitExpresswayCode: true, entryName: true, exitName: true } });
  const now = new Date().toISOString();
  const batchId = `plaza-verification-${now.replace(/[:.]/g, "-")}`;
  const operations: PlazaPlanOperation[] = [];
  const report: Record<string, unknown> = { batchId, generatedAt: now, evidence: EVIDENCE, expressways: {} };

  for (const expressway of expressways) {
    const code = expressway.abbreviation;
    const corridor = await buildCorridor(code);
    const own = plazas.filter((plaza) => plaza.expresswayId === expressway.id);
    // Rated names on this expressway, grouped so spelling variants of one plaza become one record.
    const counts = new Map<string, number>();
    for (const row of rows) for (const [rowCode, name] of [[row.entryExpresswayCode, row.entryName], [row.exitExpresswayCode, row.exitName]] as const) {
      const rowApp = toAppExpresswayCode(rowCode);
      if (rowApp !== code && !(integratedNames[code] ?? []).includes(rowApp)) continue;
      const canonical = canonicalMatrixPlaza(code, name);
      counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
      if (canonical !== name) counts.set(name, (counts.get(name) ?? 0) + 0);
    }
    const groups = new Map<string, string[]>();
    for (const name of counts.keys()) { const key = normalizePlazaName(name); groups.set(key, [...(groups.get(key) ?? []), name]); }
    const verified: Array<{ name: string; coordinate: LngLat; along: number }> = [];
    const results: unknown[] = [];
    const handled = new Set<string>();
    const verifiedBooths = new Map<string, string>();
    for (const variants of groups.values()) {
      const primary = [...variants].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.length - b.length)[0];
      const result = verifyPlaza(primary, evidence.booths, corridor, (operator) => !operator || (operators[code]?.test(operator) ?? false));
      const existing = own.find((plaza) => variants.includes(plaza.name)) ?? own.find((plaza) => variants.some((variant) => [...nameKeys(variant)].some((key) => nameKeys(plaza.name).has(key) && normalizePlazaName(plaza.name) === normalizePlazaName(variant))));
      if (existing) handled.add(existing.id);
      if (result.status === "VERIFIED_GEODATA") {
        const boothKey = result.booths.map((booth) => booth.osm).sort().join(",");
        const sameBooths = verifiedBooths.get(boothKey);
        if (sameBooths && !existing) {
          const target = operations.find((op) => op.expressway === code && (op.kind === "update" || op.kind === "create") && op.name === sameBooths);
          if (target && (target.kind === "update" || target.kind === "create")) target.data.aliases = [...new Set([...target.data.aliases, ...variants])];
          results.push({ plaza: primary, variants, status: "ALIAS", aliasOf: sameBooths });
          continue;
        }
        verifiedBooths.set(boothKey, existing?.name ?? primary);
        const source = `OpenStreetMap ${result.booths.map((booth) => booth.osm).join(", ")} (${result.booths.length} booth${result.booths.length > 1 ? "s" : ""}, ≤${result.maxCorridorKm.toFixed(2)} km from the ${code} road per Google Routes; ODbL)`;
        const aliases = [...new Set([...variants.filter((name) => name !== (existing?.name ?? primary)), ...(Array.isArray(existing?.aliases) ? existing.aliases as string[] : [])])].filter((alias) => alias !== "Canonical matrix locator");
        verified.push({ name: existing?.name ?? primary, coordinate: result.coordinate, along: positionAlongCorridorKm(result.coordinate, corridor) });
        if (existing) {
          const movedKm = distanceKm([existing.longitude, existing.latitude], result.coordinate);
          const sameAliases = JSON.stringify([...(Array.isArray(existing.aliases) ? existing.aliases as string[] : [])].sort()) === JSON.stringify([...aliases].sort());
          if (movedKm < 0.01 && existing.verificationStatus === "VERIFIED_GEODATA" && sameAliases) { results.push({ plaza: primary, variants, status: "UNCHANGED" }); continue; }
          operations.push({ kind: "update", id: existing.id, expressway: code, name: existing.name, movedKm, old: { latitude: existing.latitude, longitude: existing.longitude, aliases: existing.aliases }, data: { latitude: result.coordinate[1], longitude: result.coordinate[0], aliases, verificationStatus: "VERIFIED_GEODATA", verificationSource: source, active: true } });
        } else {
          operations.push({ kind: "create", expressway: code, expresswayId: expressway.id, name: primary, data: { latitude: result.coordinate[1], longitude: result.coordinate[0], aliases, verificationStatus: "VERIFIED_GEODATA", verificationSource: source } });
        }
        results.push({ plaza: primary, variants, status: result.status, coordinate: result.coordinate, booths: result.booths.map((booth) => `${booth.osm} ${booth.name}`), existing: existing?.name ?? null });
      } else {
        results.push({ plaza: primary, variants, status: result.status, reason: result.reason, candidates: result.candidates.map((booth) => `${booth.osm} ${booth.name} (${booth.operator ?? "no operator"}) ${booth.lat.toFixed(4)},${booth.lon.toFixed(4)}`), existing: existing?.name ?? null });
        if (existing) {
          const stacked = own.filter((plaza) => plaza.latitude.toFixed(3) === existing.latitude.toFixed(3) && plaza.longitude.toFixed(3) === existing.longitude.toFixed(3)).length;
          const judged = suspectReason(existing, stacked, corridor);
          const referenced = existing._count.entryRates + existing._count.exitRates > 0;
          if (judged && !["SUSPECT", "NEEDS_REVIEW"].includes(existing.verificationStatus)) operations.push({ kind: "suspect", id: existing.id, expressway: code, name: existing.name, reason: judged.reason, deactivate: judged.severity === "invalid" && !referenced, old: { verificationStatus: "UNVERIFIED" } });
        }
      }
    }
    // Existing records with no rated name: duplicates (canonical spelling exists) or obsolete locators.
    for (const plaza of own.filter((item) => !handled.has(item.id))) {
      const canonical = canonicalMatrixPlaza(code, plaza.name);
      const duplicateOf = canonical !== plaza.name ? own.find((item) => item.name === canonical) : undefined;
      const referenced = plaza._count.entryRates + plaza._count.exitRates > 0;
      const stacked = own.filter((item) => item.latitude.toFixed(3) === plaza.latitude.toFixed(3) && item.longitude.toFixed(3) === plaza.longitude.toFixed(3)).length;
      const judged = duplicateOf ? { reason: `Duplicate of "${duplicateOf.name}" (spelling variant used by an import).`, severity: "invalid" as const } : suspectReason(plaza, stacked, corridor);
      const reason = judged?.reason;
      if (judged && !["SUSPECT", "NEEDS_REVIEW"].includes(plaza.verificationStatus)) operations.push({ kind: "suspect", id: plaza.id, expressway: code, name: plaza.name, reason: judged.reason, deactivate: judged.severity === "invalid" && !referenced, old: { verificationStatus: "UNVERIFIED" } });
      results.push({ plaza: plaza.name, status: duplicateOf ? "DUPLICATE" : reason ? "SUSPECT" : "NOT_RATED", reason: reason ?? "No rate refers to this name.", referencedByPublishedRates: referenced });
    }
    // Plaza order along the road (from the expressway's Manila end), for sequence validation.
    verified.sort((a, b) => a.along - b.along).forEach((item, index) => {
      const operation = operations.find((op) => op.expressway === code && (op.kind === "update" || op.kind === "create") && op.name === item.name);
      if (operation && (operation.kind === "update" || operation.kind === "create")) operation.data.sequence = index + 1;
    });
    (report.expressways as Record<string, unknown>)[code] = { corridorLines: corridor.length, corridorPoints: corridor.reduce((n, line) => n + line.length, 0), results };
  }

  report.operations = operations;
  mkdirSync("data/reports", { recursive: true });
  const file = `data/reports/${batchId}.json`;
  writeFileSync(file, JSON.stringify(report, null, 1));
  const tally = (kind: string) => operations.filter((op) => op.kind === kind).length;
  console.log(`Report: ${file}`);
  console.log(`Planned: ${tally("update")} updates (${operations.filter((op) => op.kind === "update" && op.movedKm > 1).length} moved > 1 km), ${tally("create")} new plazas, ${tally("suspect")} marked suspect/inactive.`);
  if (apply) { const result = await applyPlazaPlan(prisma, operations, batchId, "script:verify-plaza-locators"); console.log("Applied:", result); }
  else console.log("Dry run only. Re-run with --apply to write these changes.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
