import { fetchTollPhMatrix, TOLL_PH_MATRIX_URL } from "./toll-ph.js";

const SOURCE_ID = "secondary-toll-ph-20260727";

/**
 * Downloads and stages Toll.ph's matrix as review data. This function never
 * creates a published RateVersion or changes a customer-facing fee.
 */
export async function stageTollPhImport(prisma) {
  const matrix = await fetchTollPhMatrix();
  const existing = await prisma.matrixImport.findUnique({
    where: { sourceId_contentHash: { sourceId: SOURCE_ID, contentHash: matrix.contentHash } },
    select: { id: true, rowCount: true, status: true },
  });

  const checkedAt = new Date();
  await prisma.rateSource.upsert({
    where: { id: SOURCE_ID },
    update: { lastCheckedAt: checkedAt, lastSuccessfulAt: checkedAt, contentHash: matrix.contentHash, enabled: false },
    create: {
      id: SOURCE_ID,
      name: "Toll.ph matrix (secondary cross-check)",
      officialUrl: TOLL_PH_MATRIX_URL,
      sourceType: "secondary_matrix_reference",
      enabled: false,
      lastCheckedAt: checkedAt,
      lastSuccessfulAt: checkedAt,
      contentHash: matrix.contentHash,
      notes: "Automated matrix collection. Every row is staged for manual comparison with TRB or operator records before publication.",
    },
  });

  if (existing) return { importId: existing.id, rowCount: existing.rowCount, status: existing.status, unchanged: true };

  const created = await prisma.$transaction(async (tx) => {
    const snapshot = await tx.sourceSnapshot.upsert({
      where: { sourceId_contentHash: { sourceId: SOURCE_ID, contentHash: matrix.contentHash } },
      update: { retrievedAt: checkedAt, requiresManualReview: true },
      create: { sourceId: SOURCE_ID, contentHash: matrix.contentHash, retrievedAt: checkedAt, requiresManualReview: true },
    });
    return tx.matrixImport.create({
      data: {
        sourceId: SOURCE_ID,
        sourceSnapshotId: snapshot.id,
        contentHash: matrix.contentHash,
        sourceUrl: TOLL_PH_MATRIX_URL,
        retrievedAt: checkedAt,
        reportedUpdatedAt: matrix.reportedUpdatedAt,
        status: "PENDING_REVIEW",
        rowCount: matrix.rows.length,
        notes: "Imported automatically from Toll.ph. Plaza identity, directionality, and every fee require primary-source verification before a RateVersion may be published.",
        rows: { create: matrix.rows },
      },
    });
  });

  return { importId: created.id, rowCount: created.rowCount, status: created.status, unchanged: false };
}
