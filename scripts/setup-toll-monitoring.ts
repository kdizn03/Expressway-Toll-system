/**
 * Configures toll-rate monitoring (idempotent) and cross-checks stored rates against TRB announcements.
 *   npx tsx --env-file=.env scripts/setup-toll-monitoring.ts
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { crossCheckAnnouncements } from "../lib/toll-data/announcements";

const prisma = new PrismaClient();

// Sources whose terms/robots.txt permit automated retrieval and for which a reliable parser exists.
const monitored: Array<{ id: string; parser: string; intervalHours: number }> = [
  { id: "secondary-toll-ph-20260727", parser: "toll-ph", intervalHours: 24 },
  { id: "secondary-expressway-ph-nlex-sctex-2026", parser: "expressway-ph-nlex-sctex", intervalHours: 24 },
  { id: "secondary-expressway-ph-skyway-slex-mcx-2026", parser: "expressway-ph:SKYWAY", intervalHours: 24 },
  { id: "secondary-expressway-ph-star-2026", parser: "expressway-ph:STAR", intervalHours: 24 },
  { id: "secondary-expressway-ph-calax-2026", parser: "expressway-ph:CALAX", intervalHours: 24 },
  { id: "secondary-expressway-ph-cavitex-2026", parser: "expressway-ph:CAVITEX", intervalHours: 24 },
  { id: "secondary-expressway-ph-nlex-slex-connector-2026", parser: "expressway-ph:NLEX_CONNECTOR", intervalHours: 24 },
];

// Authoritative sources that cannot be retrieved automatically; rates from them enter through a manual import.
const manualOnly: Array<{ id: string; name: string; url: string; sourceType: string; notes: string }> = [
  { id: "official-trb-toll-rates", name: "Toll Regulatory Board – approved toll rates", url: "https://trb.gov.ph/index.php/toll-rates", sourceType: "official_regulator", notes: "Returns HTTP 403 to automated requests (checked 2026-11-21). Enter TRB matrices through a manual import." },
  { id: "official-nlex-corp", name: "NLEX Corporation – toll rates and advisories (NLEX, SCTEX, NLEX Connector)", url: "https://nlex.com.ph/news-and-events/", sourceType: "official_operator_disclosure", notes: "robots.txt disallows all automated access (checked 2026-11-21). Manual import only." },
  { id: "official-tplex", name: "TPLEX – toll rates", url: "https://tplex.com.ph/", sourceType: "official_operator_disclosure", notes: "robots.txt disallows all automated access (checked 2026-11-21). Manual import only." },
  { id: "official-smc-tollways", name: "SMC Tollways – SLEX, Skyway, STAR, NAIAX, MCX advisories", url: "https://www.smctollways.com/", sourceType: "official_operator_disclosure", notes: "No usable robots.txt (bot-protection page); treated as not permitted. Manual import only." },
  { id: "official-mptc-cavitex-calax", name: "MPTC – CAVITEX and CALAX advisories", url: "https://cavitex.com.ph/", sourceType: "official_operator_disclosure", notes: "No machine-readable rate matrix published; homepage changes too often for change detection. Manual import only." },
];

async function main() {
  for (const source of monitored) {
    const updated = await prisma.rateSource.updateMany({ where: { id: source.id }, data: { monitorEnabled: true, parser: source.parser, checkIntervalHours: source.intervalHours } });
    console.log(`${updated.count ? "monitoring" : "NOT FOUND "} ${source.id} (${source.parser}, every ${source.intervalHours} h)`);
  }
  for (const source of manualOnly) {
    await prisma.rateSource.upsert({ where: { id: source.id }, update: { notes: source.notes, monitorEnabled: false }, create: { id: source.id, name: source.name, officialUrl: source.url, sourceType: source.sourceType, enabled: true, monitorEnabled: false, notes: source.notes } });
    console.log(`manual-only ${source.id}`);
  }
  const announcements = JSON.parse(readFileSync("data/toll-rate-announcements.json", "utf8")).announcements as unknown[];
  const result = await crossCheckAnnouncements(prisma, announcements, "script:setup-toll-monitoring");
  console.log("Announcement cross-check:", JSON.stringify(result.summary, null, 1));
  console.log("Proposed import:", result.staged.outcome, "importId" in result.staged ? result.staged.importId : "");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
