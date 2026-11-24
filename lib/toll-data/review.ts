import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { isCustomerFacingSource } from "../toll/source-policy";
import { toAppExpresswayCode } from "../toll-import/expressway-code.js";
import { diffMatrices, type MatrixDiff } from "./diff";
import { validateMatrix, type MatrixRow } from "./validation";
import { notifyAdmins } from "./notify";

type Db = PrismaClient | Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Rows of the import currently approved for a source (the baseline a new import is compared with). */
async function baselineFor(db: Db, sourceId: string) {
  const baseline = await db.matrixImport.findFirst({ where: { sourceId, status: "PUBLISHED" }, orderBy: { retrievedAt: "desc" }, include: { rows: true } });
  return { baseline, rows: (baseline?.rows ?? []) as MatrixRow[] };
}

export type StageResult = { outcome: "STAGED"; importId: string; diff: MatrixDiff } | { outcome: "DUPLICATE"; importId: string } | { outcome: "NO_RATE_CHANGES"; diff: MatrixDiff } | { outcome: "INVALID"; errors: string[] };

/**
 * Stages a matrix as a PROPOSED import (status PENDING_REVIEW) with a change report. Nothing staged
 * here is used for pricing until an administrator approves it. Identical content is never imported twice,
 * and a document whose rates match the approved version creates no import.
 */
export async function stageMatrix(prisma: PrismaClient, input: { sourceId: string; sourceUrl: string; content: string; contentType?: string; rows: unknown[]; minimumRows?: number; reportedUpdatedAt?: Date | null; effectiveFrom?: Date | null; actor: string; note?: string }): Promise<StageResult> {
  const contentHash = createHash("sha256").update(input.content).digest("hex");
  const existing = await prisma.matrixImport.findUnique({ where: { sourceId_contentHash: { sourceId: input.sourceId, contentHash } }, select: { id: true } });
  if (existing) return { outcome: "DUPLICATE", importId: existing.id };
  const { baseline, rows: baselineRows } = await baselineFor(prisma, input.sourceId);
  const validation = validateMatrix(input.rows, { minimumRows: input.minimumRows, previousRowCount: baselineRows.length || undefined });
  if (!validation.ok) return { outcome: "INVALID", errors: validation.errors.slice(0, 20) };
  const diff = diffMatrices(baselineRows, validation.rows);
  if (baseline && !diff.summary.hasChanges) return { outcome: "NO_RATE_CHANGES", diff };
  const source = await prisma.rateSource.findUniqueOrThrow({ where: { id: input.sourceId } });
  const verificationStatus = isCustomerFacingSource(source.sourceType) ? "UNDER_REVIEW" : source.sourceType === "regulator_announcement_report" ? "UNDER_REVIEW" : "THIRD_PARTY_ESTIMATE";
  const created = await prisma.$transaction(async (tx) => {
    const snapshot = await tx.sourceSnapshot.upsert({
      where: { sourceId_contentHash: { sourceId: input.sourceId, contentHash } },
      update: { retrievedAt: new Date(), requiresManualReview: true },
      create: { sourceId: input.sourceId, contentHash, requiresManualReview: true, sourceUrl: input.sourceUrl, contentType: input.contentType, byteLength: Buffer.byteLength(input.content), content: input.content.slice(0, 5_000_000) },
    });
    const matrixImport = await tx.matrixImport.create({ data: {
      sourceId: input.sourceId, sourceSnapshotId: snapshot.id, contentHash, sourceUrl: input.sourceUrl, status: "PENDING_REVIEW", rowCount: validation.rows.length,
      reportedUpdatedAt: input.reportedUpdatedAt ?? null, effectiveFrom: input.effectiveFrom ?? null, verificationStatus,
      notes: [input.note, ...validation.warnings].filter(Boolean).join(" ") || null,
      rows: { create: validation.rows },
    } });
    await tx.rateChangeReport.create({ data: { matrixImportId: matrixImport.id, baselineImportId: baseline?.id ?? null, summary: json({ ...diff.summary, complete: validation.complete, warnings: validation.warnings }), details: json({ changed: diff.changed.slice(0, 2000), added: diff.added.slice(0, 2000), removed: diff.removed.slice(0, 2000), plazasAdded: diff.plazasAdded, plazasRemoved: diff.plazasRemoved }) } });
    await tx.auditLog.create({ data: { actorId: input.actor, action: "RATE_IMPORT_STAGED", entityType: "MatrixImport", entityId: matrixImport.id, newValue: json(diff.summary), reason: `Proposed ${validation.rows.length} rows from ${source.name}` } });
    return matrixImport;
  });
  await notifyAdmins(prisma, `Toll rate changes detected: ${source.name}`, `${diff.summary.changed} changed, ${diff.summary.added} added, ${diff.summary.removed} removed fares are awaiting review (import ${created.id}).`);
  return { outcome: "STAGED", importId: created.id, diff };
}

export class ReviewError extends Error {}

/**
 * Approves a proposed import. The previously approved import from the same source is marked EXPIRED
 * (superseded, kept for history). For authoritative sources with an effective date, effective-dated
 * RateVersions are also created (SCHEDULED when the date is in the future). Runs in one transaction.
 */
export async function approveImport(prisma: PrismaClient, importId: string, actor: string, note?: string) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.matrixImport.findUniqueOrThrow({ where: { id: importId }, include: { source: true, rows: true, changeReport: true } });
    if (candidate.status !== "PENDING_REVIEW") throw new ReviewError(`Import is ${candidate.status}; only proposed imports can be approved.`);
    const validation = validateMatrix(candidate.rows);
    if (!validation.ok) throw new ReviewError(`Import failed validation: ${validation.errors.slice(0, 3).join(" ")}`);
    const official = isCustomerFacingSource(candidate.source.sourceType);
    if (official && !candidate.effectiveFrom) throw new ReviewError("An official rate import needs an effective date before it can be approved.");
    const superseded = await tx.matrixImport.updateMany({ where: { sourceId: candidate.sourceId, status: "PUBLISHED", id: { not: importId } }, data: { status: "EXPIRED", reviewNote: `Superseded by import ${importId}` } });
    await tx.matrixImport.update({ where: { id: importId }, data: { status: "PUBLISHED", reviewedBy: actor, reviewedAt: new Date(), reviewNote: note ?? null, verificationStatus: official ? "OFFICIALLY_PUBLISHED" : candidate.verificationStatus === "UNDER_REVIEW" ? "INDEPENDENTLY_VERIFIED" : candidate.verificationStatus } });
    const versions = official ? await publishRateVersions(tx, candidate.id, candidate.sourceId, candidate.effectiveFrom!, validation.rows, actor) : [];
    await tx.auditLog.create({ data: { actorId: actor, action: "RATE_IMPORT_APPROVED", entityType: "MatrixImport", entityId: importId, oldValue: json({ status: "PENDING_REVIEW" }), newValue: json({ status: "PUBLISHED", supersededImports: superseded.count, rateVersions: versions }), reason: note ?? "Approved" } });
    return { importId, supersededImports: superseded.count, rateVersions: versions };
  }, { timeout: 120_000 });
}

/** Creates effective-dated official RateVersions for each single-expressway part of an approved official import. */
async function publishRateVersions(tx: Prisma.TransactionClient, importId: string, sourceId: string, effectiveFrom: Date, rows: MatrixRow[], actor: string) {
  const byExpressway = new Map<string, MatrixRow[]>();
  for (const row of rows) { if (row.entryExpresswayCode !== row.exitExpresswayCode) continue; const code = toAppExpresswayCode(row.entryExpresswayCode); byExpressway.set(code, [...(byExpressway.get(code) ?? []), row]); }
  const created: string[] = [];
  for (const [code, expresswayRows] of byExpressway) {
    const expressway = await tx.expressway.findUnique({ where: { abbreviation: code }, include: { plazas: { where: { active: true } } } });
    if (!expressway) throw new ReviewError(`Unknown expressway ${code}.`);
    const plazaId = (name: string) => expressway.plazas.find((plaza) => plaza.name === name || (Array.isArray(plaza.aliases) && (plaza.aliases as string[]).includes(name)))?.id;
    const unmatched = [...new Set(expresswayRows.flatMap((row) => [row.entryName, row.exitName]).filter((name) => !plazaId(name)))];
    // Never publish ambiguous entry–exit combinations: every name must map to a known plaza.
    if (unmatched.length) throw new ReviewError(`${code}: no plaza record for ${unmatched.slice(0, 8).join(", ")}. Add or alias these plazas first.`);
    const classes = await tx.vehicleClass.findMany();
    const classId = (code: string) => classes.find((item) => item.code === code)!.id;
    const latest = await tx.rateVersion.findFirst({ where: { expresswayId: expressway.id }, orderBy: { versionNumber: "desc" } });
    // The previous open-ended version ends where the new one starts; history is preserved, never overwritten.
    await tx.rateVersion.updateMany({ where: { expresswayId: expressway.id, status: { in: ["PUBLISHED", "SCHEDULED"] }, effectiveTo: null, effectiveFrom: { lt: effectiveFrom } }, data: { effectiveTo: effectiveFrom } });
    const version = await tx.rateVersion.create({ data: {
      expresswayId: expressway.id, sourceId, versionNumber: (latest?.versionNumber ?? 0) + 1, effectiveFrom, status: effectiveFrom > new Date() ? "SCHEDULED" : "PUBLISHED", verifiedAt: new Date(), approvedBy: actor, createdBy: actor,
      verificationStatus: "OFFICIALLY_PUBLISHED", sourceReference: `import:${importId}`,
      rates: { create: expresswayRows.map((row) => ({ entryPlazaId: plazaId(row.entryName)!, exitPlazaId: plazaId(row.exitName)!, vehicleClassId: classId(row.vehicleClassCode), tollCentavos: row.tollCentavos })) },
    } });
    created.push(version.id);
  }
  return created;
}

/** Rejects a proposed import; it is kept for the record and never used. */
export async function rejectImport(prisma: PrismaClient, importId: string, actor: string, reason: string) {
  const candidate = await prisma.matrixImport.findUniqueOrThrow({ where: { id: importId } });
  if (candidate.status !== "PENDING_REVIEW") throw new ReviewError(`Import is ${candidate.status}; only proposed imports can be rejected.`);
  await prisma.$transaction([
    prisma.matrixImport.update({ where: { id: importId }, data: { status: "REJECTED", verificationStatus: "REJECTED", reviewedBy: actor, reviewedAt: new Date(), reviewNote: reason } }),
    prisma.auditLog.create({ data: { actorId: actor, action: "RATE_IMPORT_REJECTED", entityType: "MatrixImport", entityId: importId, oldValue: json({ status: "PENDING_REVIEW" }), newValue: json({ status: "REJECTED" }), reason } }),
  ]);
  return { importId, status: "REJECTED" };
}

/**
 * Rolls back an approved import: it becomes EXPIRED, the import it superseded is restored, official
 * RateVersions it created are withdrawn (REJECTED) and the previous versions are reopened.
 */
export async function rollbackImport(prisma: PrismaClient, importId: string, actor: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.matrixImport.findUniqueOrThrow({ where: { id: importId }, include: { changeReport: true } });
    if (target.status !== "PUBLISHED") throw new ReviewError(`Import is ${target.status}; only approved imports can be rolled back.`);
    await tx.matrixImport.update({ where: { id: importId }, data: { status: "EXPIRED", reviewNote: `Rolled back: ${reason}` } });
    const baselineId = target.changeReport?.baselineImportId;
    if (baselineId) await tx.matrixImport.update({ where: { id: baselineId }, data: { status: "PUBLISHED", reviewNote: `Restored by rollback of ${importId}` } });
    const versions = await tx.rateVersion.findMany({ where: { sourceReference: `import:${importId}` } });
    for (const version of versions) {
      await tx.rateVersion.update({ where: { id: version.id }, data: { status: "REJECTED", notes: `Rolled back: ${reason}` } });
      await tx.rateVersion.updateMany({ where: { expresswayId: version.expresswayId, effectiveTo: version.effectiveFrom, status: { in: ["PUBLISHED", "SCHEDULED"] } }, data: { effectiveTo: null } });
    }
    await tx.auditLog.create({ data: { actorId: actor, action: "RATE_IMPORT_ROLLED_BACK", entityType: "MatrixImport", entityId: importId, oldValue: json({ status: "PUBLISHED" }), newValue: json({ status: "EXPIRED", restoredImport: baselineId ?? null, withdrawnVersions: versions.map((version) => version.id) }), reason } });
    return { importId, restoredImport: baselineId ?? null, withdrawnVersions: versions.length };
  }, { timeout: 120_000 });
}
