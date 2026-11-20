import { toAppExpresswayCode } from "./expressway-code.js";

/** Server-only Google key; plaza locators use Places API (New) Text Search. */
const geocodingToken = () => process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim();

async function geocodePlaza(name, expresswayCode, key) {
  if (!key) return undefined;
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.location" },
    body: JSON.stringify({ textQuery: `${name} ${expresswayCode} toll plaza Philippines`, regionCode: "PH", languageCode: "en", pageSize: 1 }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return undefined;
  const body = await response.json();
  const location = body.places?.[0]?.location;
  return location?.longitude !== undefined && location.latitude !== undefined ? [location.longitude, location.latitude] : undefined;
}

/**
 * Creates geographic plaza candidates from the staged source names. These are
 * locator records only; the staged matrix remains review-only pricing data.
 */
export async function enrichPlazasFromMatrixImport(prisma, matrixImportId) {
  const token = geocodingToken();
  if (!token) throw new Error("Set GOOGLE_MAPS_SERVER_API_KEY (Places API (New) enabled) before matrix plazas can be located.");

  const rows = await prisma.matrixImportRow.findMany({
    where: { matrixImportId },
    select: { entryExpresswayCode: true, exitExpresswayCode: true, entryName: true, exitName: true },
    distinct: ["entryExpresswayCode", "exitExpresswayCode", "entryName", "exitName"],
  });
  const candidates = new Map();
  for (const row of rows) {
    candidates.set(`${row.entryExpresswayCode}|${row.entryName}`, { sourceCode: row.entryExpresswayCode, name: row.entryName });
    candidates.set(`${row.exitExpresswayCode}|${row.exitName}`, { sourceCode: row.exitExpresswayCode, name: row.exitName });
  }

  const expressways = await prisma.expressway.findMany({ select: { id: true, abbreviation: true } });
  const expresswayByCode = new Map(expressways.map((item) => [item.abbreviation, item]));
  let created = 0;
  let skipped = 0;

  for (const candidate of candidates.values()) {
    const expressway = expresswayByCode.get(toAppExpresswayCode(candidate.sourceCode));
    if (!expressway) { skipped += 1; continue; }
    const existing = await prisma.tollPlaza.findUnique({ where: { expresswayId_name: { expresswayId: expressway.id, name: candidate.name } } });
    if (existing) continue;
    const coordinates = await geocodePlaza(candidate.name, expressway.abbreviation, token);
    if (!coordinates) { skipped += 1; continue; }
    await prisma.tollPlaza.create({
      data: {
        expresswayId: expressway.id,
        name: candidate.name,
        longitude: coordinates[0],
        latitude: coordinates[1],
        aliases: [candidate.name, `Imported from Toll.ph (${candidate.sourceCode})`],
      },
    });
    created += 1;
  }
  return { created, skipped, candidates: candidates.size };
}

/** Ensures the plazas needed by a calculated route have coordinates before matching. */
export async function ensurePlazasForExpressways(prisma, appExpresswayCodes) {
  const sourceCodes = new Set(appExpresswayCodes.flatMap((code) => Object.entries({
    "NLEX CONN": "NLEX_CONNECTOR",
    "NLEX HARBOR": "NLEX_HARBOR_LINK",
    SKYWAY3: "SKYWAY",
  }).filter(([, mappedCode]) => mappedCode === code).map(([sourceCode]) => sourceCode).concat(code)));
  const rows = await prisma.matrixImportRow.findMany({
    where: { matrixImport: { status: "PENDING_REVIEW" }, OR: [{ entryExpresswayCode: { in: [...sourceCodes] } }, { exitExpresswayCode: { in: [...sourceCodes] } }] },
    select: { entryExpresswayCode: true, exitExpresswayCode: true, entryName: true, exitName: true },
    distinct: ["entryExpresswayCode", "exitExpresswayCode", "entryName", "exitName"],
  });
  const candidates = new Map();
  for (const row of rows) {
    if (sourceCodes.has(row.entryExpresswayCode)) candidates.set(`${row.entryExpresswayCode}|${row.entryName}`, { sourceCode: row.entryExpresswayCode, name: row.entryName });
    if (sourceCodes.has(row.exitExpresswayCode)) candidates.set(`${row.exitExpresswayCode}|${row.exitName}`, { sourceCode: row.exitExpresswayCode, name: row.exitName });
  }
  const expressways = await prisma.expressway.findMany({ where: { abbreviation: { in: appExpresswayCodes } }, select: { id: true, abbreviation: true } });
  const expresswayByCode = new Map(expressways.map((item) => [item.abbreviation, item]));
  const known = await prisma.tollPlaza.findMany({ where: { expresswayId: { in: expressways.map((item) => item.id) } }, select: { expresswayId: true, name: true } });
  const knownKeys = new Set(known.map((item) => `${item.expresswayId}|${item.name}`));
  const missing = [...candidates.values()].filter((candidate) => {
    const expressway = expresswayByCode.get(toAppExpresswayCode(candidate.sourceCode));
    return expressway && !knownKeys.has(`${expressway.id}|${candidate.name}`);
  });

  const token = geocodingToken();
  if (!token || missing.length === 0) return { created: 0, skipped: missing.length };
  let created = 0;
  let skipped = 0;
  const queue = [...missing];
  const worker = async () => {
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate) return;
      const expressway = expresswayByCode.get(toAppExpresswayCode(candidate.sourceCode));
      if (!expressway) { skipped += 1; continue; }
      try {
        const coordinates = await geocodePlaza(candidate.name, expressway.abbreviation, token);
        if (!coordinates) { skipped += 1; continue; }
        await prisma.tollPlaza.upsert({
          where: { expresswayId_name: { expresswayId: expressway.id, name: candidate.name } },
          update: {},
          create: { expresswayId: expressway.id, name: candidate.name, longitude: coordinates[0], latitude: coordinates[1], aliases: [candidate.name, `Imported from Toll.ph (${candidate.sourceCode})`] },
        });
        created += 1;
      } catch { skipped += 1; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return { created, skipped };
}
