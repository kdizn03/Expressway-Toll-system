-- Baseline of the pre-authentication schema. On an existing installation this
-- migration is recorded with `prisma migrate resolve --applied`; it is not run
-- against existing toll data. Fresh databases can use it to create the baseline.
CREATE TYPE "RateStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'SCHEDULED', 'PUBLISHED', 'EXPIRED', 'REJECTED');

CREATE TABLE "Expressway" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "abbreviation" TEXT NOT NULL, "operator" TEXT, "region" TEXT, "status" TEXT NOT NULL DEFAULT 'operational', "rfidSystem" TEXT, "tollSystemType" TEXT, "pricingModel" TEXT NOT NULL DEFAULT 'closed_matrix', "geometry" JSONB, "sourceInfo" JSONB, "notes" TEXT, "lastVerifiedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Expressway_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Expressway_name_key" ON "Expressway"("name");
CREATE UNIQUE INDEX "Expressway_abbreviation_key" ON "Expressway"("abbreviation");

CREATE TABLE "VehicleClass" ("id" TEXT NOT NULL, "code" TEXT NOT NULL, "displayName" TEXT NOT NULL, "description" TEXT, CONSTRAINT "VehicleClass_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "VehicleClass_code_key" ON "VehicleClass"("code");

CREATE TABLE "RateSource" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "officialUrl" TEXT NOT NULL, "sourceType" TEXT NOT NULL, "expresswayId" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true, "lastCheckedAt" TIMESTAMP(3), "lastSuccessfulAt" TIMESTAMP(3), "contentHash" TEXT, "notes" TEXT, CONSTRAINT "RateSource_pkey" PRIMARY KEY ("id"));

CREATE TABLE "TollPlaza" ("id" TEXT NOT NULL, "expresswayId" TEXT NOT NULL, "name" TEXT NOT NULL, "latitude" DOUBLE PRECISION NOT NULL, "longitude" DOUBLE PRECISION NOT NULL, "direction" TEXT, "externalId" TEXT, "sequence" INTEGER, "aliases" JSONB, CONSTRAINT "TollPlaza_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "TollPlaza_expresswayId_name_key" ON "TollPlaza"("expresswayId", "name");
CREATE INDEX "TollPlaza_expresswayId_idx" ON "TollPlaza"("expresswayId");

CREATE TABLE "VehicleRestriction" ("id" TEXT NOT NULL, "expresswayId" TEXT NOT NULL, "vehicleClassId" TEXT NOT NULL, "allowed" BOOLEAN NOT NULL DEFAULT true, "notes" TEXT, "effectiveFrom" TIMESTAMP(3) NOT NULL, "effectiveTo" TIMESTAMP(3), "source" TEXT, CONSTRAINT "VehicleRestriction_pkey" PRIMARY KEY ("id"));
CREATE INDEX "VehicleRestriction_expresswayId_vehicleClassId_effectiveFrom_idx" ON "VehicleRestriction"("expresswayId", "vehicleClassId", "effectiveFrom");

CREATE TABLE "RateVersion" ("id" TEXT NOT NULL, "expresswayId" TEXT NOT NULL, "sourceId" TEXT NOT NULL, "versionNumber" INTEGER NOT NULL, "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "verifiedAt" TIMESTAMP(3), "effectiveFrom" TIMESTAMP(3) NOT NULL, "effectiveTo" TIMESTAMP(3), "status" "RateStatus" NOT NULL DEFAULT 'DRAFT', "notes" TEXT, "createdBy" TEXT, "approvedBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "RateVersion_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "RateVersion_expresswayId_versionNumber_key" ON "RateVersion"("expresswayId", "versionNumber");
CREATE INDEX "RateVersion_expresswayId_status_effectiveFrom_effectiveTo_idx" ON "RateVersion"("expresswayId", "status", "effectiveFrom", "effectiveTo");

CREATE TABLE "TollRate" ("id" TEXT NOT NULL, "rateVersionId" TEXT NOT NULL, "entryPlazaId" TEXT NOT NULL, "exitPlazaId" TEXT NOT NULL, "vehicleClassId" TEXT NOT NULL, "tollCentavos" INTEGER NOT NULL, "vatIncluded" BOOLEAN NOT NULL DEFAULT true, CONSTRAINT "TollRate_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "TollRate_rateVersionId_entryPlazaId_exitPlazaId_vehicleClassId_key" ON "TollRate"("rateVersionId", "entryPlazaId", "exitPlazaId", "vehicleClassId");
CREATE INDEX "TollRate_entryPlazaId_exitPlazaId_vehicleClassId_idx" ON "TollRate"("entryPlazaId", "exitPlazaId", "vehicleClassId");

CREATE TABLE "AuditLog" ("id" TEXT NOT NULL, "actorId" TEXT, "action" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "oldValue" JSONB, "newValue" JSONB, "reason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"));

CREATE TABLE "SourceSnapshot" ("id" TEXT NOT NULL, "sourceId" TEXT NOT NULL, "contentHash" TEXT NOT NULL, "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "requiresManualReview" BOOLEAN NOT NULL DEFAULT false, CONSTRAINT "SourceSnapshot_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "SourceSnapshot_sourceId_contentHash_key" ON "SourceSnapshot"("sourceId", "contentHash");

CREATE TABLE "MatrixImport" ("id" TEXT NOT NULL, "sourceId" TEXT NOT NULL, "sourceSnapshotId" TEXT NOT NULL, "contentHash" TEXT NOT NULL, "sourceUrl" TEXT NOT NULL, "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reportedUpdatedAt" TIMESTAMP(3), "status" "RateStatus" NOT NULL DEFAULT 'PENDING_REVIEW', "rowCount" INTEGER NOT NULL, "notes" TEXT, CONSTRAINT "MatrixImport_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "MatrixImport_sourceId_contentHash_key" ON "MatrixImport"("sourceId", "contentHash");
CREATE INDEX "MatrixImport_sourceId_status_retrievedAt_idx" ON "MatrixImport"("sourceId", "status", "retrievedAt");

CREATE TABLE "MatrixImportRow" ("id" TEXT NOT NULL, "matrixImportId" TEXT NOT NULL, "entryExpresswayCode" TEXT NOT NULL, "exitExpresswayCode" TEXT NOT NULL, "entryName" TEXT NOT NULL, "exitName" TEXT NOT NULL, "vehicleClassCode" TEXT NOT NULL, "tollCentavos" INTEGER NOT NULL, "reversible" BOOLEAN NOT NULL DEFAULT false, CONSTRAINT "MatrixImportRow_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "MatrixImportRow_matrixImportId_entryExpresswayCode_exitExpresswayCode_entryName_exitName_vehicleClassCode_key" ON "MatrixImportRow"("matrixImportId", "entryExpresswayCode", "exitExpresswayCode", "entryName", "exitName", "vehicleClassCode");
CREATE INDEX "MatrixImportRow_entryExpresswayCode_exitExpresswayCode_entryName_exitName_idx" ON "MatrixImportRow"("entryExpresswayCode", "exitExpresswayCode", "entryName", "exitName");

ALTER TABLE "TollPlaza" ADD CONSTRAINT "TollPlaza_expresswayId_fkey" FOREIGN KEY ("expresswayId") REFERENCES "Expressway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleRestriction" ADD CONSTRAINT "VehicleRestriction_expresswayId_fkey" FOREIGN KEY ("expresswayId") REFERENCES "Expressway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleRestriction" ADD CONSTRAINT "VehicleRestriction_vehicleClassId_fkey" FOREIGN KEY ("vehicleClassId") REFERENCES "VehicleClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RateVersion" ADD CONSTRAINT "RateVersion_expresswayId_fkey" FOREIGN KEY ("expresswayId") REFERENCES "Expressway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RateVersion" ADD CONSTRAINT "RateVersion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RateSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TollRate" ADD CONSTRAINT "TollRate_rateVersionId_fkey" FOREIGN KEY ("rateVersionId") REFERENCES "RateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TollRate" ADD CONSTRAINT "TollRate_entryPlazaId_fkey" FOREIGN KEY ("entryPlazaId") REFERENCES "TollPlaza"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TollRate" ADD CONSTRAINT "TollRate_exitPlazaId_fkey" FOREIGN KEY ("exitPlazaId") REFERENCES "TollPlaza"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TollRate" ADD CONSTRAINT "TollRate_vehicleClassId_fkey" FOREIGN KEY ("vehicleClassId") REFERENCES "VehicleClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceSnapshot" ADD CONSTRAINT "SourceSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RateSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatrixImport" ADD CONSTRAINT "MatrixImport_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RateSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatrixImport" ADD CONSTRAINT "MatrixImport_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "SourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatrixImportRow" ADD CONSTRAINT "MatrixImportRow_matrixImportId_fkey" FOREIGN KEY ("matrixImportId") REFERENCES "MatrixImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
