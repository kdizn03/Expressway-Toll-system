-- AlterTable
ALTER TABLE "MatrixImport" ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "verificationStatus" TEXT NOT NULL DEFAULT 'THIRD_PARTY_ESTIMATE';

-- AlterTable
ALTER TABLE "MatrixImportRow" ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verificationStatus" TEXT;

-- AlterTable
ALTER TABLE "RateSource" ADD COLUMN     "autoPublish" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checkIntervalHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "etag" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastModified" TEXT,
ADD COLUMN     "monitorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nextCheckAt" TIMESTAMP(3),
ADD COLUMN     "parser" TEXT;

-- AlterTable
ALTER TABLE "RateVersion" ADD COLUMN     "sourceReference" TEXT,
ADD COLUMN     "verificationStatus" TEXT;

-- AlterTable
ALTER TABLE "SourceSnapshot" ADD COLUMN     "byteLength" INTEGER,
ADD COLUMN     "content" TEXT,
ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "sourceUrl" TEXT;

-- AlterTable
ALTER TABLE "TollPlaza" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "kmPost" DOUBLE PRECISION,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "plazaType" TEXT,
ADD COLUMN     "verificationSource" TEXT,
ADD COLUMN     "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SourceCheck" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "message" TEXT,
    "snapshotId" TEXT,
    "matrixImportId" TEXT,

    CONSTRAINT "SourceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateChangeReport" (
    "id" TEXT NOT NULL,
    "matrixImportId" TEXT NOT NULL,
    "baselineImportId" TEXT,
    "summary" JSONB NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateChangeReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TollDataSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TollDataSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "SourceCheck_sourceId_startedAt_idx" ON "SourceCheck"("sourceId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RateChangeReport_matrixImportId_key" ON "RateChangeReport"("matrixImportId");

-- AddForeignKey
ALTER TABLE "SourceCheck" ADD CONSTRAINT "SourceCheck_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RateSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateChangeReport" ADD CONSTRAINT "RateChangeReport_matrixImportId_fkey" FOREIGN KEY ("matrixImportId") REFERENCES "MatrixImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: keep current behaviour. Before this migration every staged matrix import was shown to customers
-- as a labelled estimate. The review workflow now only uses imports with status PUBLISHED, so the imports
-- already in use are marked as approved estimates; new imports start as PENDING_REVIEW and are not used.
UPDATE "MatrixImport"
SET "status" = 'PUBLISHED',
    "reviewedBy" = 'migration:20261121000000',
    "reviewedAt" = CURRENT_TIMESTAMP,
    "reviewNote" = 'Already displayed as a labelled estimate before the review workflow existed; approved for continued display as an estimate.'
WHERE "status" = 'PENDING_REVIEW';

-- The TPLEX matrix was transcribed from user-supplied TRB screenshots without an effective date.
UPDATE "MatrixImport" SET "verificationStatus" = 'UNVERIFIED'
WHERE "sourceId" = 'official-trb-tplex-user-submitted-undated';

-- The SCTEX version published from NLEX Corporation's SEC disclosure of the TRB-authorised adjustment.
UPDATE "RateVersion" SET "verificationStatus" = 'OFFICIALLY_PUBLISHED',
  "sourceReference" = 'NLEX Corp. SEC Form 17-C, implementation of the SCTEX toll rate adjustment (Sept 2025)'
WHERE "status" = 'PUBLISHED' AND "verificationStatus" IS NULL;
