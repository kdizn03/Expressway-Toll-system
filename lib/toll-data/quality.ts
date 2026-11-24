import type { PrismaClient } from "@prisma/client";
import { isInLuzonCoverage } from "../geo/luzon";
import { toAppExpresswayCode } from "../toll-import/expressway-code.js";
import { canonicalMatrixPlaza } from "../toll/plaza-name";
import { distanceKm, normalizePlazaName } from "./plaza-verification";

export type DataQualityReport = Awaited<ReturnType<typeof buildDataQualityReport>>;

/** Data-quality checks for the admin dashboard. Read-only. */
export async function buildDataQualityReport(prisma: PrismaClient, now = new Date()) {
  const [expressways, rows, rowStatus, imports, sources] = await Promise.all([
    prisma.expressway.findMany({ select: { id: true, abbreviation: true, name: true, plazas: { select: { id: true, name: true, latitude: true, longitude: true, aliases: true, active: true, verificationStatus: true, notes: true } } }, orderBy: { abbreviation: "asc" } }),
    prisma.matrixImportRow.findMany({ where: { matrixImport: { status: "PUBLISHED" }, OR: [{ verificationStatus: null }, { verificationStatus: { notIn: ["SUPERSEDED", "REJECTED"] } }] }, select: { entryExpresswayCode: true, exitExpresswayCode: true, entryName: true, exitName: true, vehicleClassCode: true, matrixImportId: true } }),
    prisma.matrixImportRow.groupBy({ by: ["verificationStatus"], where: { matrixImport: { status: "PUBLISHED" } }, _count: true }),
    prisma.matrixImport.findMany({ where: { status: { in: ["PUBLISHED", "PENDING_REVIEW"] } }, select: { id: true, status: true, verificationStatus: true, retrievedAt: true, reportedUpdatedAt: true, rowCount: true, source: { select: { name: true } }, changeReport: { select: { summary: true } } } }),
    prisma.rateSource.findMany({ select: { id: true, name: true, monitorEnabled: true, lastSuccessfulAt: true, consecutiveFailures: true, lastError: true } }),
  ]);

  const ratedNames = new Map<string, Set<string>>();
  for (const row of rows) for (const [code, name] of [[row.entryExpresswayCode, row.entryName], [row.exitExpresswayCode, row.exitName]] as const) {
    const app = toAppExpresswayCode(code); ratedNames.set(app, (ratedNames.get(app) ?? new Set()).add(canonicalMatrixPlaza(app, name)));
  }
  const missingCoordinates: Array<{ expressway: string; plaza: string }> = [];
  const suspectCoordinates: Array<{ expressway: string; plaza: string; status: string; reason: string }> = [];
  const duplicates: Array<{ expressway: string; plazas: string[]; reason: string }> = [];
  const plazasWithoutRates: Array<{ expressway: string; plaza: string }> = [];
  const unmatchedSegments: Array<{ expressway: string; reason: string }> = [];

  for (const expressway of expressways) {
    const code = expressway.abbreviation; const active = expressway.plazas.filter((plaza) => plaza.active);
    const known = new Set(active.flatMap((plaza) => [plaza.name, ...(Array.isArray(plaza.aliases) ? plaza.aliases as string[] : [])]));
    const rated = ratedNames.get(code) ?? new Set<string>();
    for (const name of rated) if (!known.has(name)) missingCoordinates.push({ expressway: code, plaza: name });
    for (const plaza of expressway.plazas) {
      if (["SUSPECT", "NEEDS_REVIEW"].includes(plaza.verificationStatus)) suspectCoordinates.push({ expressway: code, plaza: plaza.name, status: plaza.active ? plaza.verificationStatus : `${plaza.verificationStatus} (inactive)`, reason: plaza.notes ?? "" });
      else if (plaza.active && !isInLuzonCoverage([plaza.longitude, plaza.latitude])) suspectCoordinates.push({ expressway: code, plaza: plaza.name, status: "OFF_LUZON", reason: "Active locator outside Luzon." });
    }
    for (const duplicate of findDuplicatePlazas(active)) duplicates.push({ expressway: code, ...duplicate });
    for (const plaza of active) {
      const names = [plaza.name, ...(Array.isArray(plaza.aliases) ? plaza.aliases as string[] : [])];
      if (!names.some((name) => rated.has(canonicalMatrixPlaza(code, name)))) plazasWithoutRates.push({ expressway: code, plaza: plaza.name });
    }
    if (rated.size === 0) unmatchedSegments.push({ expressway: code, reason: "No approved toll rates for this expressway." });
    else if (active.length === 0) unmatchedSegments.push({ expressway: code, reason: "Rates exist but no plaza locations, so routes cannot be priced." });
  }

  // Incomplete matrices: approved imports where some plaza pairs lack one or more vehicle classes.
  const pairs = new Map<string, Map<string, Set<string>>>();
  for (const row of rows) { const byImport = pairs.get(row.matrixImportId) ?? new Map(); const key = `${row.entryExpresswayCode}|${row.entryName}|${row.exitExpresswayCode}|${row.exitName}`; byImport.set(key, (byImport.get(key) ?? new Set()).add(row.vehicleClassCode)); pairs.set(row.matrixImportId, byImport); }
  const incompleteMatrices = imports.filter((item) => item.status === "PUBLISHED").map((item) => ({ import: item.id, source: item.source.name, incompletePairs: [...(pairs.get(item.id)?.values() ?? [])].filter((classes) => classes.size < 3).length })).filter((item) => item.incompletePairs > 0);
  const STALE_DAYS = 120;
  const outdated = imports.filter((item) => item.status === "PUBLISHED" && (now.getTime() - (item.reportedUpdatedAt ?? item.retrievedAt).getTime()) / 86_400_000 > STALE_DAYS).map((item) => ({ import: item.id, source: item.source.name, dataDate: (item.reportedUpdatedAt ?? item.retrievedAt).toISOString().slice(0, 10) }));
  const verification = Object.fromEntries(rowStatus.map((group) => [group.verificationStatus ?? "IMPORT_DEFAULT", group._count]));

  return {
    generatedAt: now.toISOString(),
    counts: { missingCoordinates: missingCoordinates.length, suspectCoordinates: suspectCoordinates.length, duplicatePlazas: duplicates.length, plazasWithoutRates: plazasWithoutRates.length, incompleteMatrices: incompleteMatrices.length, outdatedImports: outdated.length, unmatchedSegments: unmatchedSegments.length, pendingImports: imports.filter((item) => item.status === "PENDING_REVIEW").length, failingSources: sources.filter((source) => source.consecutiveFailures > 0).length },
    rateVerification: verification,
    missingCoordinates, suspectCoordinates, duplicates, plazasWithoutRates, incompleteMatrices, outdated, unmatchedSegments,
    failingSources: sources.filter((source) => source.consecutiveFailures > 0).map((source) => ({ source: source.name, failures: source.consecutiveFailures, lastError: source.lastError })),
  };
}

/** Active plazas of one expressway that look like duplicates: same normalised name, or within 50 m of each other. */
export function findDuplicatePlazas(plazas: Array<{ name: string; latitude: number; longitude: number }>) {
  const found: Array<{ plazas: [string, string]; reason: string }> = [];
  for (let i = 0; i < plazas.length; i++) for (let j = i + 1; j < plazas.length; j++) {
    const a = plazas[i], b = plazas[j];
    const sameName = normalizePlazaName(a.name) === normalizePlazaName(b.name);
    const samePlace = distanceKm([a.longitude, a.latitude], [b.longitude, b.latitude]) < 0.05;
    if (sameName || samePlace) found.push({ plazas: [a.name, b.name], reason: sameName ? "Same normalised name" : "Same location (< 50 m)" });
  }
  return found;
}
