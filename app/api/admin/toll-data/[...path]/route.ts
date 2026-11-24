import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import { isAuthEnabled } from "@/lib/auth/config";
import { isInLuzonCoverage } from "@/lib/geo/luzon";
import { buildDataQualityReport } from "@/lib/toll-data/quality";
import { approveImport, rejectImport, ReviewError, rollbackImport, stageMatrix } from "@/lib/toll-data/review";
import { runTollMonitor } from "@/lib/toll-data/monitor";
import { getTollDataSettings, updateTollDataSettings } from "@/lib/toll-data/settings";
import { rollbackPlazaBatch } from "@/lib/toll-data/plaza-corrections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only signed-in administrators may read or change toll data; with accounts disabled the API does not exist. */
async function requireAdmin() {
  if (!isAuthEnabled()) return { error: NextResponse.json({ message: "Not found." }, { status: 404 }) };
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ message: "Sign in as an administrator." }, { status: 401 }) };
  if (!isAdmin(user)) return { error: NextResponse.json({ message: "Administrator access is required." }, { status: 403 }) };
  return { actor: `user:${user.id}` };
}

const plazaPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  latitude: z.number().gte(-90).lte(90).optional(),
  longitude: z.number().gte(-180).lte(180).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  plazaType: z.enum(["ENTRY_EXIT", "ENTRY", "EXIT", "BARRIER"]).nullable().optional(),
  kmPost: z.number().min(0).max(1000).nullable().optional(),
  sequence: z.number().int().min(1).max(500).nullable().optional(),
  verificationStatus: z.enum(["VERIFIED_GEODATA", "NEEDS_REVIEW", "SUSPECT", "UNVERIFIED"]).optional(),
  verificationSource: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  reason: z.string().trim().min(3).max(500),
}).refine((value) => (value.latitude === undefined) === (value.longitude === undefined), { message: "Latitude and longitude must be changed together." })
  .refine((value) => value.latitude === undefined || isInLuzonCoverage([value.longitude!, value.latitude]), { message: "Coordinates must be inside the supported Luzon coverage area." })
  .refine((value) => value.verificationStatus !== "VERIFIED_GEODATA" || Boolean(value.verificationSource), { message: "A verification source is required to mark a location verified." });

const manualImportSchema = z.object({
  sourceId: z.string().min(1),
  effectiveFrom: z.coerce.date().optional(),
  note: z.string().trim().max(1000).optional(),
  sourceUrl: z.string().trim().min(1).max(500),
  rows: z.array(z.unknown()).min(1).max(20_000),
});

const json = (value: unknown, init?: ResponseInit) => NextResponse.json(value, init);
const fail = (error: unknown) => {
  if (error instanceof ReviewError || error instanceof z.ZodError) return json({ message: error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join(" ") : error.message }, { status: 422 });
  console.error("[admin toll-data]", error);
  return json({ message: "The request could not be completed. No data was changed." }, { status: 500 });
};

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const guard = await requireAdmin(); if (guard.error) return guard.error;
  const [resource, id, sub] = (await context.params).path; const query = request.nextUrl.searchParams;
  try {
    if (resource === "quality") return json(await buildDataQualityReport(prisma));
    if (resource === "plazas") {
      const expressway = query.get("expressway") ?? undefined;
      return json(await prisma.tollPlaza.findMany({ where: expressway ? { expressway: { abbreviation: expressway } } : {}, include: { expressway: { select: { abbreviation: true } }, _count: { select: { entryRates: true, exitRates: true } } }, orderBy: [{ expressway: { abbreviation: "asc" } }, { sequence: "asc" }, { name: "asc" }] }));
    }
    if (resource === "rates") {
      const expressway = query.get("expressway"); const vehicleClass = query.get("vehicleClass");
      const rows = await prisma.matrixImportRow.findMany({
        where: { matrixImport: { status: "PUBLISHED" }, ...(vehicleClass ? { vehicleClassCode: vehicleClass } : {}), ...(expressway ? { OR: [{ entryExpresswayCode: expressway }, { exitExpresswayCode: expressway }] } : {}) },
        select: { id: true, entryExpresswayCode: true, exitExpresswayCode: true, entryName: true, exitName: true, vehicleClassCode: true, tollCentavos: true, verificationStatus: true, verificationNote: true, matrixImport: { select: { id: true, verificationStatus: true, retrievedAt: true, effectiveFrom: true, source: { select: { name: true, sourceType: true } } } } },
        orderBy: [{ entryName: "asc" }, { exitName: "asc" }, { vehicleClassCode: "asc" }], take: Math.min(Number(query.get("limit") ?? 500), 2000),
      });
      const versions = await prisma.rateVersion.findMany({ where: expressway ? { expressway: { abbreviation: expressway } } : {}, select: { id: true, versionNumber: true, status: true, effectiveFrom: true, effectiveTo: true, verificationStatus: true, sourceReference: true, expressway: { select: { abbreviation: true } }, _count: { select: { rates: true } } }, orderBy: { effectiveFrom: "desc" } });
      return json({ rows, versions });
    }
    if (resource === "imports" && !id) {
      const status = query.get("status") as Prisma.EnumRateStatusFilter["equals"] | null;
      return json(await prisma.matrixImport.findMany({ where: status ? { status } : {}, select: { id: true, status: true, verificationStatus: true, retrievedAt: true, reportedUpdatedAt: true, effectiveFrom: true, rowCount: true, reviewedBy: true, reviewedAt: true, reviewNote: true, notes: true, sourceUrl: true, source: { select: { id: true, name: true, sourceType: true } }, changeReport: { select: { summary: true } } }, orderBy: { retrievedAt: "desc" }, take: 100 }));
    }
    if (resource === "imports" && id && sub === "source") {
      const item = await prisma.matrixImport.findUniqueOrThrow({ where: { id }, select: { sourceUrl: true, sourceSnapshot: { select: { content: true, contentType: true, retrievedAt: true, contentHash: true } } } });
      if (!item.sourceSnapshot.content) return json({ message: "The original document was not stored for this import.", sourceUrl: item.sourceUrl }, { status: 404 });
      return new NextResponse(item.sourceSnapshot.content, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `inline; filename="source-${id}.txt"`, "X-Source-Url": encodeURI(item.sourceUrl), "X-Content-Sha256": item.sourceSnapshot.contentHash } });
    }
    if (resource === "imports" && id) return json(await prisma.matrixImport.findUniqueOrThrow({ where: { id }, include: { source: true, changeReport: true, rows: { take: 200, orderBy: [{ entryName: "asc" }, { exitName: "asc" }] } } }));
    if (resource === "monitor") {
      const [sources, checks, settings, alerts] = await Promise.all([
        prisma.rateSource.findMany({ select: { id: true, name: true, officialUrl: true, sourceType: true, monitorEnabled: true, parser: true, checkIntervalHours: true, lastCheckedAt: true, lastSuccessfulAt: true, nextCheckAt: true, consecutiveFailures: true, lastError: true, autoPublish: true, notes: true }, orderBy: [{ monitorEnabled: "desc" }, { name: "asc" }] }),
        prisma.sourceCheck.findMany({ orderBy: { startedAt: "desc" }, take: 50, include: { source: { select: { name: true } } } }),
        getTollDataSettings(prisma),
        prisma.auditLog.findMany({ where: { action: { in: ["TOLL_DATA_ALERT", "RATE_IMPORT_APPROVED", "RATE_IMPORT_REJECTED", "RATE_IMPORT_ROLLED_BACK"] } }, orderBy: { createdAt: "desc" }, take: 30 }),
      ]);
      return json({ sources, checks, settings, alerts });
    }
    return json({ message: "Unknown resource." }, { status: 404 });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const guard = await requireAdmin(); if (guard.error) return guard.error;
  const [resource, id, action] = (await context.params).path;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    if (resource === "imports" && id && action === "approve") return json(await approveImport(prisma, id, guard.actor, typeof body.note === "string" ? body.note : undefined));
    if (resource === "imports" && id && action === "reject") return json(await rejectImport(prisma, id, guard.actor, z.string().trim().min(3).parse(body.reason)));
    if (resource === "imports" && id && action === "rollback") return json(await rollbackImport(prisma, id, guard.actor, z.string().trim().min(3).parse(body.reason)));
    if (resource === "imports" && !id) {
      const input = manualImportSchema.parse(body);
      const result = await stageMatrix(prisma, { sourceId: input.sourceId, sourceUrl: input.sourceUrl, content: JSON.stringify({ sourceUrl: input.sourceUrl, effectiveFrom: input.effectiveFrom, rows: input.rows }), contentType: "application/json", rows: input.rows, effectiveFrom: input.effectiveFrom ?? null, actor: guard.actor, note: input.note ?? "Manual import." });
      return json(result, { status: result.outcome === "INVALID" ? 422 : 200 });
    }
    if (resource === "monitor" && id === "run") return json(await runTollMonitor(prisma, { trigger: "manual" }));
    if (resource === "plaza-batches" && id && action === "rollback") return json(await rollbackPlazaBatch(prisma, id, guard.actor));
    return json({ message: "Unknown action." }, { status: 404 });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const guard = await requireAdmin(); if (guard.error) return guard.error;
  const [resource, id] = (await context.params).path;
  const body = await request.json().catch(() => ({}));
  try {
    if (resource === "plazas" && id) {
      const { reason, ...changes } = plazaPatchSchema.parse(body);
      const updated = await prisma.$transaction(async (tx) => {
        const before = await tx.tollPlaza.findUniqueOrThrow({ where: { id } });
        const after = await tx.tollPlaza.update({ where: { id }, data: { ...changes, aliases: changes.aliases as Prisma.InputJsonValue | undefined, ...(changes.verificationStatus === "VERIFIED_GEODATA" ? { verifiedAt: new Date() } : {}) } });
        await tx.auditLog.create({ data: { actorId: guard.actor, action: "PLAZA_EDITED", entityType: "TollPlaza", entityId: id, oldValue: before as unknown as Prisma.InputJsonValue, newValue: after as unknown as Prisma.InputJsonValue, reason } });
        return after;
      });
      return json(updated);
    }
    if (resource === "settings") return json(await updateTollDataSettings(prisma, body, guard.actor));
    if (resource === "sources" && id) {
      const changes = z.object({ monitorEnabled: z.boolean().optional(), checkIntervalHours: z.number().int().min(1).max(744).optional(), autoPublish: z.boolean().optional() }).parse(body);
      const updated = await prisma.$transaction(async (tx) => {
        const before = await tx.rateSource.findUniqueOrThrow({ where: { id } });
        const after = await tx.rateSource.update({ where: { id }, data: changes });
        await tx.auditLog.create({ data: { actorId: guard.actor, action: "SOURCE_SETTINGS_UPDATED", entityType: "RateSource", entityId: id, oldValue: { monitorEnabled: before.monitorEnabled, checkIntervalHours: before.checkIntervalHours, autoPublish: before.autoPublish }, newValue: changes } });
        return after;
      });
      return json(updated);
    }
    return json({ message: "Unknown resource." }, { status: 404 });
  } catch (error) { return fail(error); }
}
