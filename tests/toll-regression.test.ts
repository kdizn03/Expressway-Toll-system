import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { normalizeGoogleRoutes, type GoogleRoutesResponse } from "../lib/routing/google-route-adapter";
import type { RouteCandidate } from "../lib/routing/types";
import type { VehicleCode } from "../lib/toll/types";

/**
 * End-to-end regression on the real toll database (read-only): RECORDED Google routes
 * (tests/fixtures/google-regression-recorded.json, google-luzon-recorded.json) → route adapter →
 * plaza matcher → toll calculator. Expected fares are the source matrix values and the TRB-approved
 * amounts confirmed from announcements (data/toll-rate-announcements.json), never invented numbers.
 * Skipped when no database is configured.
 */
const databaseUrl = existsSync(".env") ? readFileSync(".env", "utf8").split(/\r?\n/).find((line) => line.startsWith("DATABASE_URL="))?.slice(13).replace(/^"|"$/g, "") : undefined;
const recorded = { ...JSON.parse(readFileSync("tests/fixtures/google-regression-recorded.json", "utf8")).routes, ...JSON.parse(readFileSync("tests/fixtures/google-luzon-recorded.json", "utf8")).routes } as Record<string, GoogleRoutesResponse>;
const route = (name: string): RouteCandidate => normalizeGoogleRoutes(recorded[name])[0];

type Engine = { match: typeof import("../lib/toll/route-matcher").matchRouteToTolls; calculate: (roads: Awaited<ReturnType<typeof import("../lib/toll/route-matcher").matchRouteToTolls>>, vehicle: VehicleCode, roundTrip?: boolean) => ReturnType<typeof import("../lib/toll").tollCalculationService.calculate>; lookup: typeof import("../lib/toll/rate-repository").databaseRateLookup; prisma: typeof import("../lib/db").prisma };
let engine: Engine;
const travelDate = new Date("2026-11-22T08:00:00+08:00");
const segments = (result: Awaited<ReturnType<Engine["calculate"]>>) => result.segments.map((segment) => `${segment.expressway}${segment.exitExpressway ? "–" + segment.exitExpressway : ""} ${segment.entry}→${segment.exit}`);
/** The matrix amount stored for a pair (either direction when reversible), straight from the approved imports. */
async function matrixFare(codes: string[], entry: string, exit: string, vehicle: VehicleCode) {
  const row = await engine.prisma.matrixImportRow.findFirst({ where: { vehicleClassCode: vehicle, matrixImport: { status: "PUBLISHED" }, OR: [{ verificationStatus: null }, { verificationStatus: { notIn: ["SUPERSEDED", "REJECTED"] } }], AND: [{ OR: [{ entryExpresswayCode: { in: codes }, entryName: entry, exitName: exit }, { entryExpresswayCode: { in: codes }, entryName: exit, exitName: entry, reversible: true }] }] }, orderBy: { matrixImport: { retrievedAt: "desc" } } });
  return row?.tollCentavos;
}

describe.skipIf(!databaseUrl)("toll regression on representative Luzon trips (recorded routes, live rate data)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const [{ matchRouteToTolls }, { tollCalculationService }, { databaseRateLookup }, { prisma }] = await Promise.all([import("../lib/toll/route-matcher"), import("../lib/toll"), import("../lib/toll/rate-repository"), import("../lib/db")]);
    engine = { match: matchRouteToTolls, calculate: (roads, vehicle, roundTrip = false) => tollCalculationService.calculate(roads, vehicle, travelDate, roundTrip), lookup: databaseRateLookup, prisma };
  }, 60_000);

  it("Manila → Clark: NLEX Balintawak → Dau, every class equals the source matrix", async () => {
    const roads = await engine.match(route("Manila→Clark"));
    for (const vehicle of ["CLASS_1", "CLASS_2", "CLASS_3"] as VehicleCode[]) {
      const result = await engine.calculate(roads, vehicle);
      expect(segments(result)).toEqual(["NLEX Balintawak→Dau"]);
      expect(result.totalCentavos).toBe(await matrixFare(["NLEX"], "Balintawak", "Dau", vehicle));
    }
  });

  it("Baguio → Clark: TPLEX Rosario → La Paz plus SCTEX Tarlac → Clark North", async () => {
    const result = await engine.calculate(await engine.match(route("Baguio→Clark")), "CLASS_1");
    expect(segments(result)).toEqual(["TPLEX Rosario→La Paz", "SCTEX Tarlac→Clark North"]);
    expect(result.totalCentavos).toBe((await matrixFare(["TPLEX"], "La Paz", "Rosario", "CLASS_1"))! + (await matrixFare(["SCTEX"], "Tarlac", "Clark North", "CLASS_1"))!);
  });

  it("Baguio → Manila: TPLEX plus one integrated SCTEX–NLEX fare (no double charge at Mabalacat/Sta. Ines)", async () => {
    const result = await engine.calculate(await engine.match(route("Baguio→Manila")), "CLASS_1");
    expect(segments(result).slice(0, 2)).toEqual(["TPLEX Rosario→La Paz", "SCTEX–NLEX Tarlac→Balintawak"]);
    expect(result.segments[1].tollCentavos).toBe(await matrixFare(["NLEX", "SCTEX"], "Balintawak", "Tarlac", "CLASS_1"));
  });

  it("Manila → Tarlac City: one integrated NLEX–SCTEX fare", async () => {
    const result = await engine.calculate(await engine.match(route("Manila→Tarlac City")), "CLASS_2");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ expressway: "NLEX", exitExpressway: "SCTEX" });
    expect(result.totalCentavos).toBeGreaterThan(0);
  });

  it("Alabang → Silang: SLEX then CALAX, both priced from verified plaza locations", async () => {
    const result = await engine.calculate(await engine.match(route("Alabang→Silang")), "CLASS_1");
    expect(segments(result)).toEqual(["SLEX Alabang→Mamplasan", "CALAX Greenfield/Mamplasan→Silang East"]);
    expect(result.status).toBe("ESTIMATED");
    expect(result.totalCentavos).toBe((await matrixFare(["SLEX"], "Alabang", "Mamplasan", "CLASS_1"))! + (await matrixFare(["CALAX"], "Greenfield/Mamplasan", "Silang East", "CLASS_1"))!);
  });

  it("Manila → Batangas: STAR is matched from Sto. Tomas and Skyway is split at Buendia", async () => {
    const result = await engine.calculate(await engine.match(route("Manila→Batangas City")), "CLASS_1");
    const names = segments(result);
    expect(names.some((name) => name.startsWith("STAR Sto. Tomas→"))).toBe(true);
    expect(names.filter((name) => name.startsWith("SKYWAY")).length).toBeGreaterThanOrEqual(1);
    // Every segment is either priced or carries an explanation; an unknown fare is never treated as zero.
    for (const segment of result.segments) expect(segment.tollCentavos !== undefined || Boolean(segment.warning)).toBe(true);
    if (result.segments.some((segment) => segment.tollCentavos === undefined)) expect(result.totalCentavos).toBeUndefined();
  });

  it("uses the TRB-approved July 2026 SLEX and STAR fares for all classes, labelled as independently verified", async () => {
    const expected: Array<[string, string, string, number[]]> = [["SLEX", "Alabang", "Calamba", [13700, 27400, 41100]], ["STAR", "Sto. Tomas", "Batangas", [12100, 24200, 36300]], ["STAR", "Sto. Tomas", "Lipa", [6400, 12800, 19200]]];
    for (const [expressway, entry, exit, fares] of expected) for (const [index, vehicle] of (["CLASS_1", "CLASS_2", "CLASS_3"] as VehicleCode[]).entries()) {
      const rate = await engine.lookup({ expressway, entry, exit, confidence: "HIGH" }, vehicle, travelDate);
      expect(rate?.centavos).toBe(fares[index]);
      expect(rate?.verification).toBe("INDEPENDENTLY_VERIFIED");
    }
  });

  it("does not price the superseded CAVITEX Zapote → Kawit fare and explains why", async () => {
    const rate = await engine.lookup({ expressway: "CAVITEX", entry: "Bacoor/Zapote", exit: "Kawit", confidence: "HIGH" }, "CLASS_1", travelDate);
    if (rate?.centavos === undefined) expect(rate?.unavailableReason).toMatch(/superseded by the TRB-approved ₱103/);
    else expect(rate.centavos).toBe(10300); // only after an administrator approves the October 2026 rates
  });

  it("doubles the total for a round trip and never treats a missing rate as zero", async () => {
    const roads = await engine.match(route("Manila→Clark"));
    const oneWay = await engine.calculate(roads, "CLASS_1"); const roundTrip = await engine.calculate(roads, "CLASS_1", true);
    expect(roundTrip.totalCentavos).toBe(oneWay.totalCentavos! * 2);
    // An expressway segment with no rate (no plaza locations, as on NAIAX) makes the whole trip incomplete.
    const missing = await engine.calculate([{ expressway: "NAIAX", entry: "unresolved entry", exit: "unresolved exit", confidence: "LOW" }], "CLASS_1");
    expect(missing.status).toBe("INCOMPLETE");
    expect(missing.totalCentavos).toBeUndefined();
    expect(missing.segments[0].warning).toBeTruthy();
  });

  it("uses only active plaza records located inside Luzon", async () => {
    const plazas = await engine.prisma.tollPlaza.findMany({ where: { active: true }, select: { latitude: true, longitude: true } });
    const { isInLuzonCoverage } = await import("../lib/geo/luzon");
    expect(plazas.every((plaza) => isInLuzonCoverage([plaza.longitude, plaza.latitude]))).toBe(true);
  });
});
