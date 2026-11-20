import { prisma } from "@/lib/db";
import type { RateLookup } from "./calculation-service";
import { CUSTOMER_FACING_SOURCE_TYPES } from "./source-policy";
import { sourceCodesForAppExpressway } from "@/lib/toll-import/expressway-code.js";
import { canonicalMatrixPlaza } from "./plaza-name";

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

    if (rate) return { centavos: rate.tollCentavos, version: `v${rate.rateVersion.versionNumber}`, effectiveFrom: rate.rateVersion.effectiveFrom, lastVerifiedAt: rate.rateVersion.verifiedAt, source: rate.rateVersion.source.name, sourceUrl: rate.rateVersion.source.officialUrl };

    // A staged secondary matrix can provide a clearly labelled estimate. It is
    // deliberately not a RateVersion and cannot be mistaken for verified data.
    const codes = sourceCodesForAppExpressway(road.expressway);
    const exitCodes = sourceCodesForAppExpressway(road.exitExpressway ?? road.expressway);
    const entryName = canonicalMatrixPlaza(road.expressway, road.entry);
    const exitName = canonicalMatrixPlaza(road.exitExpressway ?? road.expressway, road.exit);
    const imported = await prisma.matrixImportRow.findFirst({
      where: {
        vehicleClassCode: vehicleClass,
        tollCentavos: { gt: 0 },
        // Staged regulator extracts supplied by an operator are estimates until
        // their effective date is approved; secondary matrices remain estimates
        // as well. Neither path is a published RateVersion.
        matrixImport: { status: "PENDING_REVIEW", source: { sourceType: { in: ["secondary_matrix_reference", "official_regulator"] } } },
        OR: [
          { entryExpresswayCode: { in: codes }, exitExpresswayCode: { in: exitCodes }, entryName, exitName },
          { entryExpresswayCode: { in: exitCodes }, exitExpresswayCode: { in: codes }, entryName: exitName, exitName: entryName, reversible: true },
        ],
      },
      include: { matrixImport: { include: { source: true } } },
      orderBy: { matrixImport: { retrievedAt: "desc" } },
    });
    // The flat-rate fallback below describes a single road; never apply it to a through-trip.
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
          matrixImport: { status: "PENDING_REVIEW", source: { sourceType: { in: ["secondary_matrix_reference", "official_regulator"] } } },
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
      };
    }
    return {
      centavos: imported.tollCentavos,
      version: "Third-party matrix estimate",
      effectiveFrom: imported.matrixImport.retrievedAt,
      source: imported.matrixImport.source.name,
      sourceUrl: imported.matrixImport.sourceUrl,
      estimate: true,
    };
  } catch {
    return { unavailableReason: "Rate database is currently unavailable. Start PostgreSQL to retrieve verified toll fees." };
  }
};
