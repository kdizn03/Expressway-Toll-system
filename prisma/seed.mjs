import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Registry records intentionally contain no toll prices. Published pricing must cite an official source.
  await Promise.all([
    ["NLEX", "North Luzon Expressway"], ["SCTEX", "Subic–Clark–Tarlac Expressway"], ["TPLEX", "Tarlac–Pangasinan–La Union Expressway"],
    ["NLEX_CONNECTOR", "NLEX Connector"], ["SLEX", "South Luzon Expressway"], ["SKYWAY", "Skyway"], ["CALAX", "Cavite–Laguna Expressway"],
    ["CAVITEX", "Manila–Cavite Expressway"], ["C5_LINK", "C5 Link Expressway"], ["STAR", "Southern Tagalog Arterial Road"], ["MCX", "Muntinlupa–Cavite Expressway"], ["NAIAX", "NAIA Expressway"],
  ].map(([abbreviation, name]) => prisma.expressway.upsert({ where: { abbreviation }, update: { name }, create: { abbreviation, name } })));

  await Promise.all([
    ["CLASS_1", "Class 1", "Passenger cars and light vehicles; access rules vary by tollway."],
    ["CLASS_2", "Class 2", "Medium commercial vehicles; verify tollway restrictions."],
    ["CLASS_3", "Class 3", "Heavy vehicles; verify tollway restrictions."],
  ].map(([code, displayName, description]) => prisma.vehicleClass.upsert({ where: { code }, update: { displayName, description }, create: { code, displayName, description } })));

  // Secondary matrices are registered for update checks and manual comparison.
  // They are deliberately disabled and can never be returned by the pricing
  // repository: only an official regulator/operator source can publish a fee.
  const secondarySources = [
    {
      id: "secondary-toll-ph-20260727",
      name: "Toll.ph matrix (secondary cross-check)",
      officialUrl: "https://toll.ph/matrix",
      lastCheckedAt: new Date("2026-07-27T00:00:00+08:00"),
      notes: "Reports TRB as its source and a 2026-07-27 update. Use to detect possible changes, then verify each affected value against a primary TRB or operator notice before import.",
    },
    {
      id: "secondary-expressway-ph-202602",
      name: "Expressway.PH matrix (secondary cross-check)",
      officialUrl: "https://www.expressway.ph/toll-matrix",
      lastCheckedAt: new Date("2026-02-01T00:00:00+08:00"),
      notes: "Reports Class 1 matrices from TRB/operator sources and a February 2026 verification. It is not a primary record; do not publish from it without a matching official notice.",
    },
    {
      id: "secondary-tollculator-20260810",
      name: "netPinoy Tollculator (secondary cross-check)",
      officialUrl: "https://apps.netpinoy.com/Tollculator/",
      lastCheckedAt: new Date("2026-08-10T00:00:00+08:00"),
      notes: "Reports official TRB rates and an August 2026 update. Use only as a comparison signal; it has no primary rate document attached here.",
    },
  ];
  await Promise.all(secondarySources.map((item) => prisma.rateSource.upsert({
    where: { id: item.id },
    update: { ...item, sourceType: "secondary_matrix_reference", enabled: false, lastSuccessfulAt: item.lastCheckedAt },
    create: { ...item, sourceType: "secondary_matrix_reference", enabled: false, lastSuccessfulAt: item.lastCheckedAt },
  })));

  // Verified SCTEX matrix: TRB-authorized final tranche, VAT-inclusive, effective 2025-09-09.
  // Source: NLEX Corporation SEC disclosure (official operator), linked in the rate version below.
  const sctex = await prisma.expressway.findUniqueOrThrow({ where: { abbreviation: "SCTEX" } });
  const [tipo, mabalacat, tarlac] = await Promise.all([
    prisma.tollPlaza.upsert({ where: { expresswayId_name: { expresswayId: sctex.id, name: "Tipo" } }, update: { latitude: 14.8419, longitude: 120.3541, sequence: 1, aliases: ["Tipo Toll Plaza"] }, create: { expresswayId: sctex.id, name: "Tipo", latitude: 14.8419, longitude: 120.3541, sequence: 1, aliases: ["Tipo Toll Plaza"] } }),
    prisma.tollPlaza.upsert({ where: { expresswayId_name: { expresswayId: sctex.id, name: "Mabalacat" } }, update: { latitude: 15.1975, longitude: 120.5964, sequence: 2, aliases: ["Mabiga", "Mabalacat Interchange"] }, create: { expresswayId: sctex.id, name: "Mabalacat", latitude: 15.1975, longitude: 120.5964, sequence: 2, aliases: ["Mabiga", "Mabalacat Interchange"] } }),
    prisma.tollPlaza.upsert({ where: { expresswayId_name: { expresswayId: sctex.id, name: "Tarlac" } }, update: { latitude: 15.4630, longitude: 120.6758, sequence: 3, aliases: ["Tarlac City Toll Plaza", "SCTEX Tarlac Exit"] }, create: { expresswayId: sctex.id, name: "Tarlac", latitude: 15.4630, longitude: 120.6758, sequence: 3, aliases: ["Tarlac City Toll Plaza", "SCTEX Tarlac Exit"] } }),
  ]);
  const source = await prisma.rateSource.upsert({ where: { id: "official-nlex-sctex-2025" }, update: {}, create: { id: "official-nlex-sctex-2025", name: "NLEX Corporation / TRB-authorized SCTEX adjustment", officialUrl: "https://nlex.com.ph/wp-content/uploads/2025/09/2025-NLEX-Corp-SEC-Form-17-C-Implementation-of-SCTEX-Toll-Rate-Adjustment.pdf", sourceType: "official_operator_disclosure", enabled: true, lastCheckedAt: new Date("2025-09-05"), lastSuccessfulAt: new Date("2025-09-05"), notes: "TRB-authorized final SCTEX adjustment; VAT-inclusive illustrated tolls." } });
  const version = await prisma.rateVersion.upsert({ where: { expresswayId_versionNumber: { expresswayId: sctex.id, versionNumber: 20250909 } }, update: {}, create: { expresswayId: sctex.id, sourceId: source.id, versionNumber: 20250909, verifiedAt: new Date("2025-09-05"), effectiveFrom: new Date("2025-09-09T00:00:00+08:00"), status: "PUBLISHED", notes: "SCTEX final tranche. Do not replace without a newer official matrix." } });
  const classes = await prisma.vehicleClass.findMany({ where: { code: { in: ["CLASS_1", "CLASS_2", "CLASS_3"] } } });
  const classByCode = new Map(classes.map((item) => [item.code, item]));
  const rates = [
    [tipo, mabalacat, [37000, 74000, 111000]], [mabalacat, tipo, [37000, 74000, 111000]],
    [mabalacat, tarlac, [23000, 46000, 68900]], [tarlac, mabalacat, [23000, 46000, 68900]],
    [tipo, tarlac, [60000, 120000, 180000]], [tarlac, tipo, [60000, 120000, 180000]],
  ];
  await Promise.all(rates.flatMap(([entry, exit, amounts]) => ["CLASS_1", "CLASS_2", "CLASS_3"].map((code, index) => prisma.tollRate.upsert({ where: { rateVersionId_entryPlazaId_exitPlazaId_vehicleClassId: { rateVersionId: version.id, entryPlazaId: entry.id, exitPlazaId: exit.id, vehicleClassId: classByCode.get(code).id } }, update: { tollCentavos: amounts[index], vatIncluded: true }, create: { rateVersionId: version.id, entryPlazaId: entry.id, exitPlazaId: exit.id, vehicleClassId: classByCode.get(code).id, tollCentavos: amounts[index], vatIncluded: true } }))));
}

main()
  .catch((error) => {
    if (error?.code === "P1000" || (error instanceof Error && error.message.includes("Authentication failed against database server"))) {
      console.error("Database authentication failed. Set DATABASE_URL in .env to the PostgreSQL username and password chosen during installation.");
    } else {
      console.error("Database seed failed:", error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
