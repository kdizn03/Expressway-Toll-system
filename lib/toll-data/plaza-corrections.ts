import type { Prisma, PrismaClient } from "@prisma/client";

/** One planned change to toll plaza locators. Every change is audit-logged under a batch id for rollback. */
export type PlazaPlanOperation =
  | { kind: "update"; id: string; expressway: string; name: string; movedKm: number; old: Record<string, unknown>; data: { latitude: number; longitude: number; aliases: string[]; verificationStatus: string; verificationSource: string; active: boolean; sequence?: number } }
  | { kind: "create"; expressway: string; expresswayId: string; name: string; data: { latitude: number; longitude: number; aliases: string[]; verificationStatus: string; verificationSource: string; sequence?: number } }
  | { kind: "suspect"; id: string; expressway: string; name: string; reason: string; deactivate: boolean; old: Record<string, unknown> };

/**
 * Applies a plaza plan in one transaction. Records are never deleted: suspect or duplicate locators are
 * deactivated with a note, so historical rates that reference them remain interpretable.
 */
export async function applyPlazaPlan(prisma: PrismaClient, operations: PlazaPlanOperation[], batchId: string, actor: string) {
  const verifiedAt = new Date();
  return prisma.$transaction(async (tx) => {
    let updated = 0, created = 0, flagged = 0;
    for (const operation of operations) {
      if (operation.kind === "update") {
        const before = await tx.tollPlaza.findUniqueOrThrow({ where: { id: operation.id } });
        const after = await tx.tollPlaza.update({ where: { id: operation.id }, data: { ...operation.data, aliases: operation.data.aliases as Prisma.InputJsonValue, verifiedAt } });
        await audit(tx, actor, "PLAZA_LOCATION_VERIFIED", operation.id, before, after, batchId, `${operation.expressway} ${operation.name}: moved ${operation.movedKm.toFixed(2)} km`);
        updated++;
      } else if (operation.kind === "create") {
        const after = await tx.tollPlaza.create({ data: { expresswayId: operation.expresswayId, name: operation.name, ...operation.data, aliases: operation.data.aliases as Prisma.InputJsonValue, verifiedAt } });
        await audit(tx, actor, "PLAZA_CREATED", after.id, null, after, batchId, `${operation.expressway} ${operation.name}: added from verified booth location`);
        created++;
      } else {
        const before = await tx.tollPlaza.findUniqueOrThrow({ where: { id: operation.id } });
        const after = await tx.tollPlaza.update({ where: { id: operation.id }, data: { verificationStatus: operation.deactivate ? "SUSPECT" : "NEEDS_REVIEW", notes: operation.reason, active: operation.deactivate ? false : before.active } });
        await audit(tx, actor, "PLAZA_FLAGGED_SUSPECT", operation.id, before, after, batchId, `${operation.expressway} ${operation.name}: ${operation.reason}`);
        flagged++;
      }
    }
    return { batchId, updated, created, flagged };
  }, { timeout: 120_000 });
}

async function audit(tx: Prisma.TransactionClient, actorId: string, action: string, entityId: string, oldValue: unknown, newValue: unknown, batchId: string, reason: string) {
  await tx.auditLog.create({ data: { actorId, action, entityType: "TollPlaza", entityId, oldValue: (oldValue ?? undefined) as Prisma.InputJsonValue | undefined, newValue: newValue as Prisma.InputJsonValue, reason: `[${batchId}] ${reason}` } });
}

/** Reverts every plaza change made in a batch, newest first. Created plazas are deleted only if no rate references them; otherwise deactivated. */
export async function rollbackPlazaBatch(prisma: PrismaClient, batchId: string, actor: string) {
  const entries = await prisma.auditLog.findMany({ where: { entityType: "TollPlaza", reason: { startsWith: `[${batchId}]` } }, orderBy: { createdAt: "desc" } });
  return prisma.$transaction(async (tx) => {
    let reverted = 0;
    for (const entry of entries) {
      if (entry.action === "PLAZA_CREATED") {
        const references = await tx.tollRate.count({ where: { OR: [{ entryPlazaId: entry.entityId }, { exitPlazaId: entry.entityId }] } });
        if (references === 0) await tx.tollPlaza.delete({ where: { id: entry.entityId } });
        else await tx.tollPlaza.update({ where: { id: entry.entityId }, data: { active: false, notes: `Deactivated by rollback of ${batchId}` } });
      } else if (entry.oldValue && typeof entry.oldValue === "object") {
        const old = entry.oldValue as Record<string, unknown>;
        await tx.tollPlaza.update({ where: { id: entry.entityId }, data: {
          latitude: old.latitude as number, longitude: old.longitude as number, aliases: (old.aliases ?? undefined) as Prisma.InputJsonValue | undefined,
          verificationStatus: (old.verificationStatus as string) ?? "UNVERIFIED", verificationSource: (old.verificationSource as string | null) ?? null,
          verifiedAt: old.verifiedAt ? new Date(old.verifiedAt as string) : null, active: (old.active as boolean) ?? true, notes: (old.notes as string | null) ?? null, sequence: (old.sequence as number | null) ?? null,
        } });
      }
      await tx.auditLog.create({ data: { actorId: actor, action: "ROLLBACK", entityType: "TollPlaza", entityId: entry.entityId, oldValue: entry.newValue ?? undefined, newValue: entry.oldValue ?? undefined, reason: `[rollback ${batchId}] reverted ${entry.action}` } });
      reverted++;
    }
    return { batchId, reverted };
  }, { timeout: 120_000 });
}
