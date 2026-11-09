import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const sources = [
  ["secondary-expressway-ph-skyway-slex-mcx-2026", "https://expresswayph.com/expressways/skyway-slex-mcx/", "SKYWAY", "Skyway–SLEX–MCX integrated"],
  ["secondary-expressway-ph-star-2026", "https://expresswayph.com/expressways/star/", "STAR", "STAR Tollway"],
  ["secondary-expressway-ph-calax-2026", "https://expresswayph.com/expressways/calax/", "CALAX", "CALAX"],
  ["secondary-expressway-ph-cavitex-2026", "https://expresswayph.com/expressways/cavitex/", "CAVITEX", "CAVITEX"],
  ["secondary-expressway-ph-nlex-slex-connector-2026", "https://expresswayph.com/expressways/nlex-slex-connector/", "NLEX_CONNECTOR", "NLEX–SLEX Connector"],
];
const clean = (value) => value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|\u00a0/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const parseFee = (value) => { const match = clean(value).match(/(?:₱\s*)?([\d,]+(?:\.\d{1,2})?)$/); return match ? Math.round(Number(match[1].replace(/,/g, "")) * 100) : undefined; };
function parse(html, expresswayCode) {
  const rows = [];
  for (const vehicleClass of [1, 2, 3]) {
    const start = html.lastIndexOf(`>Class ${vehicleClass}<`); const end = vehicleClass === 3 ? html.indexOf("</main>", start) : html.lastIndexOf(`>Class ${vehicleClass + 1}<`);
    if (start < 0 || end < 0) throw new Error(`Class ${vehicleClass} table not found.`);
    const table = html.slice(start, end);
    const headers = [...(table.match(/<thead[\s\S]*?<\/thead>/)?.[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g) ?? [])].map((item) => clean(item[1])).slice(1);
    const body = table.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? "";
    for (const row of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row[1].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/g)].map((item) => item[1]); const exitName = clean(cells[0] ?? "");
      cells.slice(1).forEach((cell, index) => { const tollCentavos = parseFee(cell); const entryName = headers[index]; if (tollCentavos && entryName && exitName) rows.push({ entryExpresswayCode: expresswayCode, exitExpresswayCode: expresswayCode, entryName, exitName, vehicleClassCode: `CLASS_${vehicleClass}`, tollCentavos, reversible: true }); });
    }
  }
  if (!rows.length) throw new Error("No matrix rows were parsed."); return rows;
}
const prisma = new PrismaClient();
try {
  for (const [id, url, code, label] of sources) {
    const response = await fetch(url); if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
    const html = await response.text(), contentHash = createHash("sha256").update(html).digest("hex"), rows = parse(html, code);
    await prisma.rateSource.upsert({ where: { id }, update: { enabled: false, lastCheckedAt: new Date(), contentHash }, create: { id, name: `ExpresswayPH ${label} matrix (2026 estimate)`, officialUrl: url, sourceType: "secondary_matrix_reference", enabled: false, lastCheckedAt: new Date(), contentHash, notes: "User-authorized estimate import. Confirm against a regulator/operator notice before publishing." } });
    const existing = await prisma.matrixImport.findUnique({ where: { sourceId_contentHash: { sourceId: id, contentHash } } });
    if (existing) console.log(`${label}: already staged (${existing.rowCount} rows).`);
    else { const snapshot = await prisma.sourceSnapshot.create({ data: { sourceId: id, contentHash, requiresManualReview: true } }); const imported = await prisma.matrixImport.create({ data: { sourceId: id, sourceSnapshotId: snapshot.id, contentHash, sourceUrl: url, status: "PENDING_REVIEW", rowCount: rows.length, notes: `User-authorized ExpresswayPH ${label} 2026 estimate.`, rows: { create: rows } } }); console.log(`${label}: staged ${imported.rowCount} estimate rows.`); }
  }
} finally { await prisma.$disconnect(); }
