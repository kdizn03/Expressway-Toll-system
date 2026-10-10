import { PrismaClient } from "@prisma/client";
import { stageTollPhImport } from "../lib/toll-import/import-service.js";

const prisma = new PrismaClient();

try {
  const result = await stageTollPhImport(prisma);
  console.log(result.unchanged ? `No change: ${result.rowCount} staged rows already exist.` : `Staged ${result.rowCount} Toll.ph matrix rows for review.`);
} catch (error) {
  console.error("Toll.ph import failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
