import { prisma } from "@/lib/db";
import type { RateLookup } from "./calculation-service";
import { CUSTOMER_FACING_SOURCE_TYPES } from "./source-policy";
import { sourceCodesForAppExpressway } from "@/lib/toll-import/expressway-code.js";
import { canonicalMatrixPlaza } from "./plaza-name";

/**
 * Matrix rows are used only from imports an administrator approved (status PUBLISHED). Rows marked
 * SUPERSEDED (a newer approved adjustment exists) or REJECTED are never priced.
 */
const APPROVED_IMPORT = { status: "PUBLISHED" as const, source: { sourceType: { in: ["secondary_matrix_reference", "official_regulator", "official_operator_disclosure", "regulator_announcement_report"] } } };
const USABLE_ROW = { OR: [{ verificationStatus: null }, { verificationStatus: { notIn: ["SUPERSEDED", "REJECTED"] } }] };

/** Database boundary for toll pricing. React components must never read toll values directly. */
export const databaseRateLookup: RateLookup = async (road, vehicleClass, travelDate) => {
  try {
    // Published rate versions belong to one expressway, so an integrated through-trip
    // (entry on one expressway, exit on another) can only come from a matrix.
    const rate = road.exitExpressway ? null : await prisma.tollRate.findFirst({
    where: {
      vehicleClass: { code: vehicleClass },
      entryPlaza: { name: road.entry },
      exitPlaza: { name: road.exit },
      rateVersion: {
        status: "PUBLISHED",
        effectiveFrom: { lte: travelDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: travelDate } }],
        expressway: { abbreviation: road.expressway },
        source: {
          enabled: true,
          sourceType: { in: [...CUSTOMER_FACING_SOURCE_TYPES] },
        },
      },
    },
    include: { rateVersion: { include: { source: true } } },
    orderBy: { rateVersion: { effectiveFrom: "desc" } },
    });

    if (rate) return { centavos: rate.tollCentavos, version: `v${rate.rateVersion.versionNumber}`, effectiveFrom: rate.rateVersion.effectiveFrom, lastVerifiedAt: rate.rateVersion.verifiedAt, source: rate.rateVersion.source.name, sourceUrl: rate.rateVersion.source.officialUrl, verification: rate.rateVersion.verificationStatus ?? "OFFICIALLY_PUBLISHED" };

    // A staged secondary matrix can provide a clearly labelled estimate. It is
    // deliberately not a RateVersion and cannot be mistaken for verified data.
    // Skyway–SLEX is one priced system: the integrated matrix lists SLEX exits (e.g. Alabang → Sto. Tomas)
    // under the Skyway code. SLEX fares fall back to it only when the SLEX code has no row for the pair;
    // Skyway fares never fall back to SLEX rows, because elevated and at-grade fares differ for the same names.
    if (road.expressway === "SLEX" && !road.exitExpressway) {
      const own = await matrixRate(road, vehicleClass, sourceCodesForAppExpressway("SLEX"), sourceCodesForAppExpressway("SLEX"));
      if (own) return own;
      const integrated = await matrixRate(road, vehicleClass, sourceCodesForAppExpressway("SKYWAY"), sourceCodesForAppExpressway("SKYWAY"));
      if (integrated) return { ...integrated, version: "Integrated Skyway–SLEX matrix estimate" };
    }
    // A Skyway section ending at a Skyway/SLEX hand-over exit (e.g. Buendia → Alabang) is listed in the
    // integrated matrix as a Skyway → SLEX row; use it when no Skyway-only row exists.
    if (road.expressway === "SKYWAY" && !road.exitExpressway) {
      const own = await matrixRate(road, vehicleClass, sourceCodesForAppExpressway("SKYWAY"), sourceCodesForAppExpressway("SKYWAY"));
      if (own) return own;
      const handover = await matrixRate({ ...road, exitExpressway: "SLEX" }, vehicleClass, sourceCodesForAppExpressway("SKYWAY"), sourceCodesForAppExpressway("SLEX"));
      if (handover) return handover;
    }
    const codes = sourceCodesForAppExpressway(road.expressway);
    const exitCodes = sourceCodesForAppExpressway(road.exitExpressway ?? road.expressway);
    const entryName = { in: await nameVariants(road.expressway, road.entry) };
    const exitName = { in: await nameVariants(road.exitExpressway ?? road.expressway, road.exit) };
    const imported = await prisma.matrixImportRow.findFirst({
      where: {
        vehicleClassCode: vehicleClass,
        tollCentavos: { gt: 0 },
        // Staged regulator extracts supplied by an operator are estimates until
        // their effective date is approved; secondary matrices remain estimates
        // as well. Neither path is a published RateVersion.
        matrixImport: APPROVED_IMPORT,
        AND: [USABLE_ROW],
        OR: [
          { entryExpresswayCode: { in: codes }, exitExpresswayCode: { in: exitCodes }, entryName, exitName },
          { entryExpresswayCode: { in: exitCodes }, exitExpresswayCode: { in: codes }, entryName: exitName, exitName: entryName, reversible: true },
        ],
      },
      include: { matrixImport: { include: { source: true } } },
      orderBy: { matrixImport: { retrievedAt: "desc" } },
    });
    // The flat-rate fallback below describes a single road; never apply it to a through-trip.
    if (!imported) {
      // Explain a missing fare when the only stored estimate was superseded by an approved adjustment.
      const superseded = await prisma.matrixImportRow.findFirst({
        where: { vehicleClassCode: vehicleClass, verificationStatus: "SUPERSEDED", matrixImport: { status: "PUBLISHED" }, OR: [
          { entryExpresswayCode: { in: codes }, exitExpresswayCode: { in: exitCodes }, entryName, exitName },
          { entryExpresswayCode: { in: exitCodes }, exitExpresswayCode: { in: codes }, entryName: exitName, exitName: entryName },
        ] },
        select: { verificationNote: true },
      });
      if (superseded) return { unavailableReason: superseded.verificationNote ?? "The stored estimate was superseded by a newer approved toll adjustment that is awaiting review." };
    }
    if (!imported && road.exitExpressway) return undefined;
    if (!imported) {
      // Some roads use a genuinely flat matrix. If map geometry cannot tell
      // which connector ramp was used, a single matrix amount is still a
      // defensible estimate; mixed-price matrices must remain unavailable.
      const flatRows = await prisma.matrixImportRow.findMany({
        where: {
          vehicleClassCode: vehicleClass,
          tollCentavos: { gt: 0 },
          OR: [{ entryExpresswayCode: { in: codes } }, { exitExpresswayCode: { in: codes } }],
          matrixImport: APPROVED_IMPORT,
          AND: [USABLE_ROW],
        },
        include: { matrixImport: { include: { source: true } } },
        orderBy: { matrixImport: { retrievedAt: "desc" } },
      });
      const amounts = [...new Set(flatRows.map((row) => row.tollCentavos))];
      if (amounts.length !== 1 || !flatRows[0]) return undefined;
      return {
        centavos: amounts[0],
        version: "Flat-rate matrix estimate",
        effectiveFrom: flatRows[0].matrixImport.retrievedAt,
        source: flatRows[0].matrixImport.source.name,
        sourceUrl: flatRows[0].matrixImport.sourceUrl,
        estimate: true,
        verification: "THIRD_PARTY_ESTIMATE",
      };
    }
    return {
      centavos: imported.tollCentavos,
      version: "Third-party matrix estimate",
      effectiveFrom: imported.matrixImport.retrievedAt,
      source: imported.matrixImport.source.name,
      sourceUrl: imported.matrixImport.sourceUrl,
      estimate: true,
      verification: imported.verificationStatus ?? imported.matrixImport.verificationStatus,
    };
  } catch {
    return { unavailableReason: "Rate database is currently unavailable. Start PostgreSQL to retrieve verified toll fees." };
  }
};

/** Looks up one matrix row for a plaza pair within the given expressway codes (approved imports, usable rows only). */
async function matrixRate(road: { expressway: string; exitExpressway?: string; entry: string; exit: string }, vehicleClass: string, codes: string[], exitCodes: string[]) {
  const entryName = { in: await nameVariants(road.expressway, road.entry) };
  const exitName = { in: await nameVariants(road.exitExpressway ?? road.expressway, road.exit) };
  const row = await prisma.matrixImportRow.findFirst({
    where: { vehicleClassCode: vehicleClass, tollCentavos: { gt: 0 }, matrixImport: APPROVED_IMPORT, AND: [USABLE_ROW], OR: [
      { entryExpresswayCode: { in: codes }, exitExpresswayCode: { in: exitCodes }, entryName, exitName },
      { entryExpresswayCode: { in: exitCodes }, exitExpresswayCode: { in: codes }, entryName: exitName, exitName: entryName, reversible: true },
    ] },
    include: { matrixImport: { include: { source: true } } },
    orderBy: { matrixImport: { retrievedAt: "desc" } },
  });
  return row ? { centavos: row.tollCentavos, version: "Third-party matrix estimate", effectiveFrom: row.matrixImport.retrievedAt, source: row.matrixImport.source.name, sourceUrl: row.matrixImport.sourceUrl, estimate: true, verification: row.verificationStatus ?? row.matrixImport.verificationStatus } : undefined;
}

/** A plaza's own name, its canonical matrix spelling, and its recorded aliases (e.g. "Laguna Blvd." / "Laguna Boulevard"). */
async function nameVariants(expressway: string, name: string) {
  const plaza = await prisma.tollPlaza.findFirst({ where: { name, expressway: { abbreviation: expressway } }, select: { aliases: true } });
  const aliases = Array.isArray(plaza?.aliases) ? (plaza!.aliases as unknown[]).filter((alias): alias is string => typeof alias === "string" && alias !== "Canonical matrix locator") : [];
  return [...new Set([name, canonicalMatrixPlaza(expressway, name), ...aliases])];
}
