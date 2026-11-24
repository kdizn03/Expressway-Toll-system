/**
 * Reverts one plaza-correction batch (see the batch ids in data/reports/plaza-verification-*.json or the audit log).
 *   npm run toll:rollback-plazas -- <batchId>
 */
import { PrismaClient } from "@prisma/client";
import { rollbackPlazaBatch } from "../lib/toll-data/plaza-corrections";

const batchId = process.argv[2];
if (!batchId) { console.error("Usage: npm run toll:rollback-plazas -- <batchId>"); process.exit(2); }
const prisma = new PrismaClient();
rollbackPlazaBatch(prisma, batchId, "script:rollback-plaza-batch")
  .then((result) => console.log(result))
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
