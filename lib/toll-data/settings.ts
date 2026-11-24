import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

/**
 * Global toll-data policy. Automatic publication is OFF unless an administrator turns it on, and even
 * then it applies only to authoritative sources that also opt in (RateSource.autoPublish).
 */
export const tollDataSettingsSchema = z.object({
  autoPublishOfficial: z.boolean().default(false),
  /** Default re-check interval for new monitored sources, in hours. */
  defaultCheckIntervalHours: z.number().int().min(1).max(24 * 31).default(24),
});
export type TollDataSettings = z.infer<typeof tollDataSettingsSchema>;
const KEY = "toll-data-settings";

export async function getTollDataSettings(prisma: PrismaClient): Promise<TollDataSettings> {
  const row = await prisma.tollDataSetting.findUnique({ where: { key: KEY } });
  const parsed = tollDataSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : tollDataSettingsSchema.parse({});
}

export async function updateTollDataSettings(prisma: PrismaClient, input: unknown, actor: string) {
  const current = await getTollDataSettings(prisma);
  const next = tollDataSettingsSchema.parse({ ...current, ...(input as object) });
  await prisma.$transaction([
    prisma.tollDataSetting.upsert({ where: { key: KEY }, update: { value: next, updatedBy: actor }, create: { key: KEY, value: next, updatedBy: actor } }),
    prisma.auditLog.create({ data: { actorId: actor, action: "TOLL_SETTINGS_UPDATED", entityType: "TollDataSetting", entityId: KEY, oldValue: current, newValue: next } }),
  ]);
  return next;
}
