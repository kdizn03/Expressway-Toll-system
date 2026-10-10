import { prisma } from "@/lib/db";
import type { RateLookup } from "./calculation-service";
import { CUSTOMER_FACING_SOURCE_TYPES } from "./source-policy";
import { sourceCodesForAppExpressway } from "@/lib/toll-import/expressway-code.js";

/** Database boundary for toll pricing. React components must never read toll values directly. */
export const databaseRateLookup: RateLookup = async (road, vehicleClass, travelDate) => {
  try {
    const rate = await prisma.tollRate.findFirst({
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
    const imported = await prisma.matrixImportRow.findFirst({
      where: {
        vehicleClassCode: vehicleClass,
        matrixImport: { status: "PENDING_REVIEW", source: { sourceType: "secondary_matrix_reference" } },
        OR: [
          { entryExpresswayCode: { in: codes }, exitExpresswayCode: { in: codes }, entryName: road.entry, exitName: road.exit },
          { entryExpresswayCode: { in: codes }, exitExpresswayCode: { in: codes }, entryName: road.exit, exitName: road.entry, reversible: true },
        ],
      },
      include: { matrixImport: { include: { source: true } } },
      orderBy: { matrixImport: { retrievedAt: "desc" } },
    });
    if (!imported) return undefined;
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
