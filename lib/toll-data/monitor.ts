import { createHash } from "node:crypto";
import type { PrismaClient, RateSource } from "@prisma/client";
import { isCustomerFacingSource } from "../toll/source-policy";
import { runParser } from "./parsers";
import { approveImport, stageMatrix } from "./review";
import { notifyAdmins } from "./notify";
import { getTollDataSettings } from "./settings";

export type MonitorTrigger = "daily" | "weekly" | "manual";
export type SourceCheckOutcome = "UNCHANGED" | "CHANGED" | "FAILED" | "SKIPPED";
type Fetch = typeof fetch;

const USER_AGENT = "LuzonTollmap/1.0 toll-rate-monitor";
/**
 * A lease row (TollDataSetting "monitor-lock") prevents two monitor runs from staging or publishing at the
 * same time. It is taken and released atomically and expires on its own if a run crashes, so it works with
 * pooled connections (unlike session-scoped advisory locks).
 */
export const MONITOR_LEASE_KEY = "monitor-lock";
const LEASE_MINUTES = 30;
async function acquireLease(prisma: PrismaClient, owner: string) {
  const rows = await prisma.$queryRaw<Array<{ key: string }>>`
    INSERT INTO "TollDataSetting" ("key", "value", "updatedAt")
    VALUES (${MONITOR_LEASE_KEY}, jsonb_build_object('owner', ${owner}::text, 'until', (now() + make_interval(mins => ${LEASE_MINUTES}::int))::text), now())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()
    WHERE ("TollDataSetting"."value"->>'until')::timestamptz < now()
    RETURNING "key"`;
  return rows.length === 1;
}
async function releaseLease(prisma: PrismaClient, owner: string) {
  await prisma.$executeRaw`DELETE FROM "TollDataSetting" WHERE "key" = ${MONITOR_LEASE_KEY} AND "value"->>'owner' = ${owner}::text`;
}

/** Hours to wait before retrying a failing source: 1, 2, 4 … capped at the source's normal interval (max 24). */
export function retryDelayHours(consecutiveFailures: number, intervalHours: number) {
  return Math.min(Math.max(1, intervalHours), 24, 2 ** Math.max(0, consecutiveFailures - 1));
}

/** Minimal robots.txt check for the "*" user agent (longest matching Allow/Disallow rule wins). */
export function robotsAllows(robotsTxt: string, path: string) {
  let applies = false; const rules: Array<{ allow: boolean; path: string }> = [];
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(); const [field, ...rest] = line.split(":"); const value = rest.join(":").trim();
    if (/^user-agent$/i.test(field)) applies = value === "*";
    else if (applies && /^(dis)?allow$/i.test(field) && value) rules.push({ allow: /^allow$/i.test(field), path: value.replace(/\*$/, "") });
  }
  const matching = rules.filter((rule) => path.startsWith(rule.path)).sort((a, b) => b.path.length - a.path.length);
  return matching.length === 0 || matching[0].allow;
}

async function permittedByRobots(url: string, fetchImpl: Fetch, cache: Map<string, string | null>) {
  const { origin, pathname } = new URL(url);
  if (!cache.has(origin)) {
    try {
      const response = await fetchImpl(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
      const type = response.headers.get("content-type") ?? "";
      // No robots.txt (404) means no restriction; an HTML error page instead of a robots file is treated as "not permitted".
      cache.set(origin, response.status === 404 ? "" : response.ok && type.includes("text/plain") ? await response.text() : null);
    } catch { cache.set(origin, null); }
  }
  const robots = cache.get(origin);
  return robots === null ? false : robotsAllows(robots ?? "", pathname);
}

export type SourceCheckResult = { sourceId: string; outcome: SourceCheckOutcome; message: string; importId?: string };

/** Checks one source, records a SourceCheck, and never modifies approved rates when anything fails. */
export async function checkSource(prisma: PrismaClient, source: RateSource, trigger: MonitorTrigger, options: { now?: Date; fetchImpl?: Fetch; robotsCache?: Map<string, string | null> } = {}): Promise<SourceCheckResult> {
  const now = options.now ?? new Date(); const fetchImpl = options.fetchImpl ?? fetch; const robotsCache = options.robotsCache ?? new Map();
  const check = await prisma.sourceCheck.create({ data: { sourceId: source.id, trigger, outcome: "SKIPPED" } });
  // The content hash (and validators) are recorded only after the content was processed successfully,
  // so a failed extraction is retried on the next run instead of being mistaken for "unchanged".
  let processed: { contentHash: string; etag: string | null; lastModified: string | null } | undefined;
  const finish = async (outcome: SourceCheckOutcome, message: string, extra: { httpStatus?: number; snapshotId?: string; matrixImportId?: string } = {}) => {
    const failed = outcome === "FAILED";
    if (!failed && processed) await prisma.rateSource.update({ where: { id: source.id }, data: processed });
    const failures = failed ? source.consecutiveFailures + 1 : 0;
    const nextHours = failed ? retryDelayHours(failures, source.checkIntervalHours) : source.checkIntervalHours;
    await prisma.sourceCheck.update({ where: { id: check.id }, data: { outcome, message, finishedAt: new Date(), ...extra } });
    await prisma.rateSource.update({ where: { id: source.id }, data: { lastCheckedAt: now, ...(failed ? {} : { lastSuccessfulAt: now }), consecutiveFailures: failures, lastError: failed ? message : null, nextCheckAt: new Date(now.getTime() + nextHours * 3_600_000) } });
    if (failed && (failures === 1 || failures % 3 === 0)) await notifyAdmins(prisma, `Toll source check failed: ${source.name}`, `${message} Existing approved rates were kept. Attempt ${failures}; next retry in ${nextHours} h. A manual import is available on the admin page.`);
    return { sourceId: source.id, outcome, message, importId: extra.matrixImportId };
  };

  try {
    if (!(await permittedByRobots(source.officialUrl, fetchImpl, robotsCache))) return finish("SKIPPED", "The site's robots.txt does not permit automated access; use a manual import.");
    // Daily checks use conditional requests; the weekly check re-downloads and re-validates everything.
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (trigger === "daily") { if (source.etag) headers["If-None-Match"] = source.etag; if (source.lastModified) headers["If-Modified-Since"] = source.lastModified; }
    let response: Response;
    try { response = await fetchImpl(source.officialUrl, { headers, signal: AbortSignal.timeout(45_000) }); }
    catch (error) { return finish("FAILED", `Source could not be reached (${error instanceof Error ? error.message : "network error"}).`); }
    if (response.status === 304) return finish("UNCHANGED", "Not modified since the last check.", { httpStatus: 304 });
    if (!response.ok) return finish("FAILED", `Source returned HTTP ${response.status}.`, { httpStatus: response.status });
    const content = await response.text();
    const contentHash = createHash("sha256").update(content).digest("hex");
    processed = { contentHash, etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
    if (contentHash === source.contentHash && trigger !== "weekly") return finish("UNCHANGED", "Content is identical to the last check.", { httpStatus: response.status });

    if (!source.parser || source.parser === "document-hash") {
      const snapshot = await prisma.sourceSnapshot.upsert({ where: { sourceId_contentHash: { sourceId: source.id, contentHash } }, update: {}, create: { sourceId: source.id, contentHash, requiresManualReview: true, sourceUrl: source.officialUrl, contentType: response.headers.get("content-type"), byteLength: Buffer.byteLength(content), content: content.slice(0, 5_000_000) } });
      await notifyAdmins(prisma, `Official toll document changed: ${source.name}`, "The document changed and needs a person to read it. Enter any new rates through a manual import.");
      return finish("CHANGED", "Document changed; manual review required.", { httpStatus: response.status, snapshotId: snapshot.id });
    }

    let parsed;
    try { parsed = runParser(source.parser, content); }
    catch (error) { return finish("FAILED", `Extraction failed (${error instanceof Error ? error.message : "parser error"}); the source format may have changed.`, { httpStatus: response.status }); }
    if (!parsed) return finish("UNCHANGED", "No parser output.");
    const staged = await stageMatrix(prisma, { sourceId: source.id, sourceUrl: source.officialUrl, content, contentType: response.headers.get("content-type") ?? undefined, rows: parsed.rows, minimumRows: parsed.minimumRows, reportedUpdatedAt: parsed.reportedUpdatedAt ?? null, actor: `toll-monitor:${trigger}` });
    if (staged.outcome === "INVALID") return finish("FAILED", `Extracted matrix failed validation: ${staged.errors.slice(0, 2).join(" ")}`, { httpStatus: response.status });
    if (staged.outcome === "DUPLICATE") return finish("UNCHANGED", "This exact document was already imported.", { httpStatus: response.status, matrixImportId: staged.importId });
    if (staged.outcome === "NO_RATE_CHANGES") return finish("UNCHANGED", "Document changed but every fare matches the approved version.", { httpStatus: response.status });

    // Optional automatic publication: only for authoritative sources, when both the global policy and the
    // source allow it, and only for complete matrices with an effective date (approveImport re-validates).
    const settings = await getTollDataSettings(prisma);
    const report = await prisma.rateChangeReport.findUnique({ where: { matrixImportId: staged.importId } });
    const complete = Boolean((report?.summary as { complete?: boolean } | null)?.complete);
    if (settings.autoPublishOfficial && source.autoPublish && isCustomerFacingSource(source.sourceType) && complete) {
      try { await approveImport(prisma, staged.importId, "auto-publish"); return finish("CHANGED", "Rate changes detected and auto-published under the enabled policy.", { httpStatus: response.status, matrixImportId: staged.importId }); }
      catch (error) { await notifyAdmins(prisma, `Auto-publication declined: ${source.name}`, error instanceof Error ? error.message : "Validation failed."); }
    }
    return finish("CHANGED", `Rate changes detected: ${staged.diff.summary.changed} changed, ${staged.diff.summary.added} added, ${staged.diff.summary.removed} removed; awaiting review.`, { httpStatus: response.status, matrixImportId: staged.importId });
  } catch (error) {
    return finish("FAILED", `Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Runs every due monitored source. Returns immediately if another run holds the lock. */
export async function runTollMonitor(prisma: PrismaClient, options: { trigger: MonitorTrigger; now?: Date; fetchImpl?: Fetch; sourceIds?: string[] }) {
  const now = options.now ?? new Date();
  const owner = `${options.trigger}-${now.toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!(await acquireLease(prisma, owner))) return { skipped: true, reason: "Another toll monitor run is in progress.", results: [] as SourceCheckResult[] };
  try {
    const sources = await prisma.rateSource.findMany({ where: { monitorEnabled: true, ...(options.sourceIds ? { id: { in: options.sourceIds } } : {}) }, orderBy: { name: "asc" } });
    const due = sources.filter((source) => options.trigger !== "daily" || !source.nextCheckAt || source.nextCheckAt <= now);
    const robotsCache = new Map<string, string | null>();
    const results: SourceCheckResult[] = [];
    for (const source of due) results.push(await checkSource(prisma, source, options.trigger, { now, fetchImpl: options.fetchImpl, robotsCache }));
    return { skipped: false, checked: results.length, notDue: sources.length - due.length, results };
  } finally {
    await releaseLease(prisma, owner);
  }
}
