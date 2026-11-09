import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// User-supplied transcription of the three TPLEX matrix screenshots. The
// screenshots omit an effective date, so this script stages—not publishes—the
// values for review against the linked TRB notice.
const plazas = ["La Paz", "Victoria", "Gerona", "Paniqui", "Moncada", "Carmen", "Urdaneta", "Binalonan", "Pozorrubio", "Sison", "Rosario"];
const matrices = {
  CLASS_1: [[30], [58, 28], [79, 49, 21], [99, 69, 41, 20], [164, 134, 106, 85, 65], [216, 186, 158, 137, 117, 52], [235, 205, 177, 156, 136, 71, 19], [270, 240, 212, 191, 171, 106, 54, 35], [290, 260, 232, 212, 192, 127, 75, 56, 21], [311, 281, 253, 232, 212, 147, 95, 76, 41, 21]],
  CLASS_2: [[76], [145, 70], [197, 122, 52], [247, 171, 102, 50], [410, 334, 264, 213, 163], [540, 464, 394, 343, 293, 130], [587, 511, 441, 390, 340, 177, 47], [675, 599, 530, 478, 428, 265, 135, 88], [726, 651, 581, 529, 479, 316, 186, 139, 51], [778, 702, 632, 581, 531, 368, 238, 191, 103, 52]],
  CLASS_3: [[91], [175, 84], [237, 146, 62], [396, 206, 122, 60], [492, 401, 317, 255, 195], [648, 557, 473, 411, 351, 156], [704, 614, 530, 468, 408, 213, 57], [810, 719, 635, 573, 514, 318, 162, 106], [871, 781, 697, 635, 575, 380, 224, 167, 62], [933, 843, 759, 697, 637, 442, 286, 229, 124, 62]],
};
const sourceId = "official-trb-tplex-user-submitted-undated";
const sourceUrl = "https://trb.gov.ph/index.php/toll-rates/tplex-toll-rate";
const rows = Object.entries(matrices).flatMap(([vehicleClassCode, matrix]) => matrix.flatMap((values, exitIndex) => values.flatMap((fee, entryIndex) => [
  { entryExpresswayCode: "TPLEX", exitExpresswayCode: "TPLEX", entryName: plazas[entryIndex], exitName: plazas[exitIndex + 1], vehicleClassCode, tollCentavos: fee * 100, reversible: true },
])));
const contentHash = createHash("sha256").update(JSON.stringify({ plazas, matrices })).digest("hex");
const prisma = new PrismaClient();

try {
  await prisma.rateSource.upsert({
    where: { id: sourceId },
    update: { officialUrl: sourceUrl, sourceType: "official_regulator", enabled: false, lastCheckedAt: new Date(), notes: "TPLEX matrix transcribed from user-supplied TRB screenshots. Effective date was not visible; review before publication." },
    create: { id: sourceId, name: "TRB TPLEX matrix (user-supplied, effective date pending)", officialUrl: sourceUrl, sourceType: "official_regulator", enabled: false, lastCheckedAt: new Date(), notes: "TPLEX matrix transcribed from user-supplied TRB screenshots. Effective date was not visible; review before publication." },
  });
  const existing = await prisma.matrixImport.findUnique({ where: { sourceId_contentHash: { sourceId, contentHash } }, select: { id: true, rowCount: true } });
  if (existing) console.log(`TPLEX matrix already staged (${existing.rowCount} source rows).`);
  else {
    const snapshot = await prisma.sourceSnapshot.upsert({ where: { sourceId_contentHash: { sourceId, contentHash } }, update: {}, create: { sourceId, contentHash, requiresManualReview: true } });
    const imported = await prisma.matrixImport.create({ data: { sourceId, sourceSnapshotId: snapshot.id, contentHash, sourceUrl, status: "PENDING_REVIEW", rowCount: rows.length, notes: "Class 1–3 values transcribed from supplied screenshots. Confirm the official effective date and plaza naming before creating a published RateVersion.", rows: { create: rows } } });
    console.log(`Staged ${imported.rowCount} TPLEX matrix rows for review.`);
  }
} finally { await prisma.$disconnect(); }
