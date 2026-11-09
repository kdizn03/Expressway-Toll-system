import { PrismaClient } from "@prisma/client";
import { enrichPlazasFromMatrixImport } from "../lib/toll-import/plaza-enrichment.js";

const prisma = new PrismaClient();

try {
  const matrixImport = await prisma.matrixImport.findFirst({
    where: { status: "PENDING_REVIEW" },
    orderBy: { retrievedAt: "desc" },
    select: { id: true },
  });
  if (!matrixImport) throw new Error("No pending matrix import is available for plaza enrichment.");
  const result = await enrichPlazasFromMatrixImport(prisma, matrixImport.id);
  console.log(`Plaza enrichment completed: ${result.created} created, ${result.skipped} skipped, ${result.candidates} candidates.`);
} catch (error) {
  console.error("Plaza enrichment failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
