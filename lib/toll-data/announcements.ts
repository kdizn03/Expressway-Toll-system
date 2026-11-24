import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { stageMatrix } from "./review";
import { isCustomerFacingSource } from "../toll/source-policy";
import type { MatrixRow } from "./validation";

export const announcementSchema = z.object({
  id: z.string().min(1),
  expresswayCodes: z.array(z.string().min(1)).min(1),
  entryNames: z.array(z.string().min(1)).min(1),
  exitNames: z.array(z.string().min(1)).min(1),
  fares: z.record(z.enum(["CLASS_1", "CLASS_2", "CLASS_3"]), z.number().positive()),
  effectiveFrom: z.coerce.date(),
  sources: z.array(z.string().url()).min(1),
});
export type Announcement = z.infer<typeof announcementSchema>;

export const ANNOUNCEMENT_SOURCE_ID = "trb-announcements-news-reports";

type Row = { id: string; entryExpresswayCode: string; exitExpresswayCode: string; entryName: string; exitName: string; vehicleClassCode: string; tollCentavos: number; verificationStatus: string | null; matrixImport: { retrievedAt: Date; reportedUpdatedAt: Date | null; source: { sourceType: string } } };

/**
 * Pure comparison of one stored row with an announcement (which must already be in effect):
 * VERIFIED when amounts match; SUPERSEDED when a third-party row differs (an announced TRB-approved rate
 * outranks third-party data, and a page still showing the old fare is stale); CONFLICT when an official
 * row differs, which a person must resolve. Announcements not yet in effect never change a label.
 */
export function compareWithAnnouncement(row: { tollCentavos: number; official: boolean }, announcedCentavos: number, effectiveFrom: Date, now = new Date()): "VERIFIED" | "SUPERSEDED" | "CONFLICT" | "NOT_YET_EFFECTIVE" {
  if (effectiveFrom > now) return "NOT_YET_EFFECTIVE";
  if (row.tollCentavos === announcedCentavos) return "VERIFIED";
  return row.official ? "CONFLICT" : "SUPERSEDED";
}

/**
 * Cross-checks approved matrix rows against TRB announcements (news-reported) and stages the announced
 * fares as a proposed import for review. Row labels change; amounts are never changed here.
 */
export async function crossCheckAnnouncements(prisma: PrismaClient, input: unknown[], actor: string) {
  const announcements = input.map((item) => announcementSchema.parse(item));
  const summary = { verified: 0, superseded: 0, conflicts: [] as string[], proposedRows: 0, notFound: [] as string[] };
  const proposed: MatrixRow[] = [];
  for (const announcement of announcements) {
    let matchedAny = false;
    for (const [vehicleClassCode, pesos] of Object.entries(announcement.fares)) {
      const centavos = Math.round(pesos * 100);
      const rows: Row[] = await prisma.matrixImportRow.findMany({
        where: { vehicleClassCode, matrixImport: { status: "PUBLISHED" }, OR: [
          { entryExpresswayCode: { in: announcement.expresswayCodes }, entryName: { in: announcement.entryNames }, exitName: { in: announcement.exitNames } },
          { entryExpresswayCode: { in: announcement.expresswayCodes }, entryName: { in: announcement.exitNames }, exitName: { in: announcement.entryNames }, reversible: true },
        ] },
        select: { id: true, entryExpresswayCode: true, exitExpresswayCode: true, entryName: true, exitName: true, vehicleClassCode: true, tollCentavos: true, verificationStatus: true, matrixImport: { select: { retrievedAt: true, reportedUpdatedAt: true, source: { select: { sourceType: true } } } } },
      });
      const sources = announcement.sources.join(" ; ");
      const effective = announcement.effectiveFrom.toISOString().slice(0, 10);
      for (const row of rows) {
        matchedAny = true;
        const verdict = compareWithAnnouncement({ tollCentavos: row.tollCentavos, official: isCustomerFacingSource(row.matrixImport.source.sourceType) }, centavos, announcement.effectiveFrom);
        if (verdict === "VERIFIED") {
          await updateRow(prisma, row, "INDEPENDENTLY_VERIFIED", `Matches the TRB-approved ₱${pesos} effective ${effective} (${sources}).`, actor);
          summary.verified++;
        } else if (verdict === "SUPERSEDED") {
          await updateRow(prisma, row, "SUPERSEDED", `₱${row.tollCentavos / 100} was superseded by the TRB-approved ₱${pesos} effective ${effective} (${sources}); the new rate is awaiting administrator review.`, actor);
          summary.superseded++;
        } else if (verdict === "CONFLICT") summary.conflicts.push(`${announcement.id} ${vehicleClassCode}: stored ₱${row.tollCentavos / 100} vs announced ₱${pesos}`);
      }
      const code = announcement.expresswayCodes[0];
      proposed.push({ entryExpresswayCode: code, exitExpresswayCode: code, entryName: announcement.entryNames.at(-1)!, exitName: announcement.exitNames[0], vehicleClassCode: vehicleClassCode as MatrixRow["vehicleClassCode"], tollCentavos: centavos, reversible: true });
    }
    if (!matchedAny) summary.notFound.push(announcement.id);
  }
  // Stage the announced fares as one proposed import (deduplicated by content), never published automatically.
  await prisma.rateSource.upsert({
    where: { id: ANNOUNCEMENT_SOURCE_ID },
    update: { lastCheckedAt: new Date() },
    create: { id: ANNOUNCEMENT_SOURCE_ID, name: "TRB-approved adjustments (news reports)", officialUrl: "data/toll-rate-announcements.json", sourceType: "regulator_announcement_report", enabled: true, monitorEnabled: false, notes: "TRB announcements as reported by news outlets. Evidence for cross-checking; approval required before use." },
  });
  const content = JSON.stringify(announcements);
  const latestEffective = announcements.reduce((latest, item) => item.effectiveFrom > latest ? item.effectiveFrom : latest, new Date(0));
  const staged = await stageMatrix(prisma, { sourceId: ANNOUNCEMENT_SOURCE_ID, sourceUrl: "data/toll-rate-announcements.json", content, contentType: "application/json", rows: proposed, minimumRows: 1, effectiveFrom: latestEffective, actor, note: "Announced TRB-approved fares for specific segments (news-reported)." });
  summary.proposedRows = staged.outcome === "STAGED" ? proposed.length : 0;
  return { summary, staged };
}

async function updateRow(prisma: PrismaClient, row: Row, status: string, note: string, actor: string) {
  if (row.verificationStatus === status) return;
  await prisma.$transaction([
    prisma.matrixImportRow.update({ where: { id: row.id }, data: { verificationStatus: status, verificationNote: note } }),
    prisma.auditLog.create({ data: { actorId: actor, action: status === "SUPERSEDED" ? "RATE_ROW_SUPERSEDED" : "RATE_ROW_VERIFIED", entityType: "MatrixImportRow", entityId: row.id, oldValue: { verificationStatus: row.verificationStatus } as Prisma.InputJsonValue, newValue: { verificationStatus: status } as Prisma.InputJsonValue, reason: note } }),
  ]);
}
