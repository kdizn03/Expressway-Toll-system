import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { approveImport, rejectImport, ReviewError, rollbackImport, stageMatrix } from "../lib/toll-data/review";
import { MONITOR_LEASE_KEY, runTollMonitor } from "../lib/toll-data/monitor";
import { updateTollDataSettings } from "../lib/toll-data/settings";
import type { MatrixRow } from "../lib/toll-data/validation";

/**
 * Integration tests for the update workflow against an ISOLATED PostgreSQL schema ("toll_workflow_test"),
 * created with the project's migrations and dropped afterwards. The application's data is never touched.
 * Skipped when no DATABASE_URL is configured.
 */
const envUrl = existsSync(".env") ? readFileSync(".env", "utf8").split(/\r?\n/).find((line) => line.startsWith("DATABASE_URL="))?.slice(13).replace(/^"|"$/g, "") : undefined;
const testUrl = envUrl ? envUrl.replace(/schema=[^&]+/, "schema=toll_workflow_test").concat(envUrl.includes("schema=") ? "" : `${envUrl.includes("?") ? "&" : "?"}schema=toll_workflow_test`) : undefined;
let prisma: PrismaClient;

const star = (pairs: Array<[string, string, number[]]>): MatrixRow[] => pairs.flatMap(([entry, exit, fares]) => fares.map((pesos, index) => ({ entryExpresswayCode: "STAR", exitExpresswayCode: "STAR", entryName: entry, exitName: exit, vehicleClassCode: `CLASS_${index + 1}` as MatrixRow["vehicleClassCode"], tollCentavos: pesos * 100, reversible: true })));
// STAR fares before (Jan 2026) and after (TRB-approved, effective 1 Jul 2026) the second tranche.
const january = star([["Sto. Tomas", "Lipa", [60, 119, 179]], ["Lipa", "Batangas", [53, 105, 158]]]);
const july = star([["Sto. Tomas", "Lipa", [64, 128, 192]], ["Lipa", "Batangas", [57, 114, 171]]]);
const page = (rows: MatrixRow[]) => {
  const table = (vehicleClass: string) => `<h2>Class ${vehicleClass.slice(-1)}</h2><table><thead><tr><th>x</th><th>Sto. Tomas</th><th>Lipa</th></tr></thead><tbody>${["Lipa", "Batangas"].map((exit) => `<tr><td>${exit}</td>${["Sto. Tomas", "Lipa"].map((entry) => { const found = rows.find((row) => row.vehicleClassCode === vehicleClass && row.entryName === entry && row.exitName === exit); return `<td>${found ? `₱${found.tollCentavos / 100}` : "—"}</td>`; }).join("")}</tr>`).join("")}</tbody></table>`;
  return `<main>${["CLASS_1", "CLASS_2", "CLASS_3"].map(table).join("")}</main>`;
};
const fakeFetch = (pages: Record<string, { status?: number; body?: string; type?: string }>): typeof fetch => (async (input: string | URL | Request) => {
  const url = String(input); const entry = pages[url] ?? pages[new URL(url).pathname] ?? { status: 404, body: "" };
  return new Response(entry.body ?? "", { status: entry.status ?? 200, headers: { "content-type": entry.type ?? "text/html" } });
}) as typeof fetch;
const ROBOTS_OK = { body: "User-agent: *\nAllow: /", type: "text/plain" };

describe.skipIf(!testUrl)("toll rate update workflow (isolated database schema)", () => {
  beforeAll(async () => {
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: testUrl }, stdio: "ignore" });
    prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
    for (const [code, displayName] of [["CLASS_1", "Class 1"], ["CLASS_2", "Class 2"], ["CLASS_3", "Class 3"]]) await prisma.vehicleClass.create({ data: { code, displayName } });
    const expressway = await prisma.expressway.create({ data: { name: "Southern Tagalog Arterial Road", abbreviation: "STAR" } });
    for (const [name, latitude, longitude] of [["Sto. Tomas", 14.1268, 121.1401], ["Lipa", 13.9419, 121.1382], ["Batangas", 13.7971, 121.0767]] as const) await prisma.tollPlaza.create({ data: { expresswayId: expressway.id, name, latitude, longitude, verificationStatus: "VERIFIED_GEODATA" } });
    await prisma.rateSource.create({ data: { id: "third-party", name: "Third-party STAR matrix", officialUrl: "https://example.test/star", sourceType: "secondary_matrix_reference", monitorEnabled: true, parser: "expressway-ph:STAR" } });
    await prisma.rateSource.create({ data: { id: "operator", name: "Operator STAR notice", officialUrl: "https://operator.test/star", sourceType: "official_operator_disclosure", monitorEnabled: false, parser: "expressway-ph:STAR", autoPublish: true } });
    // Baseline: the January matrix, approved and in use.
    const baseline = await stageMatrix(prisma, { sourceId: "third-party", sourceUrl: "https://example.test/star", content: page(january), rows: january, actor: "test" });
    if (baseline.outcome !== "STAGED") throw new Error("baseline not staged");
    await approveImport(prisma, baseline.importId, "test");
  }, 180_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "toll_workflow_test" CASCADE`);
    await prisma.$disconnect();
  });

  const approvedRows = async (sourceId: string) => (await prisma.matrixImportRow.findMany({ where: { matrixImport: { sourceId, status: "PUBLISHED" } }, orderBy: [{ entryName: "asc" }, { vehicleClassCode: "asc" }] })).map((row) => `${row.entryName}→${row.exitName} ${row.vehicleClassCode} ${row.tollCentavos}`);

  it("detects a new matrix with changed prices and stages it for review without using it", async () => {
    const before = await approvedRows("third-party");
    const result = await runTollMonitor(prisma, { trigger: "manual", fetchImpl: fakeFetch({ "https://example.test/robots.txt": ROBOTS_OK, "https://example.test/star": { body: page(july) } }) });
    expect(result.results[0]).toMatchObject({ outcome: "CHANGED" });
    const staged = await prisma.matrixImport.findUniqueOrThrow({ where: { id: result.results[0].importId! }, include: { changeReport: true } });
    expect(staged.status).toBe("PENDING_REVIEW");
    expect(staged.changeReport?.summary).toMatchObject({ changed: 6, added: 0, removed: 0, complete: true });
    expect(await approvedRows("third-party")).toEqual(before); // nothing changes until approval
  });

  it("does not import the same document twice", async () => {
    const result = await runTollMonitor(prisma, { trigger: "weekly", fetchImpl: fakeFetch({ "https://example.test/robots.txt": ROBOTS_OK, "https://example.test/star": { body: page(july) } }) });
    expect(result.results[0].outcome).toBe("UNCHANGED");
    expect(await prisma.matrixImport.count({ where: { sourceId: "third-party", status: "PENDING_REVIEW" } })).toBe(1);
  });

  it("records failed checks, backs off, alerts admins, and preserves approved rates", async () => {
    const before = await approvedRows("third-party");
    const result = await runTollMonitor(prisma, { trigger: "manual", fetchImpl: fakeFetch({ "https://example.test/robots.txt": ROBOTS_OK, "https://example.test/star": { status: 503 } }) });
    expect(result.results[0]).toMatchObject({ outcome: "FAILED" });
    const source = await prisma.rateSource.findUniqueOrThrow({ where: { id: "third-party" } });
    expect(source.consecutiveFailures).toBe(1); expect(source.lastError).toMatch(/HTTP 503/);
    expect(source.nextCheckAt!.getTime() - source.lastCheckedAt!.getTime()).toBe(3_600_000);
    expect(await prisma.auditLog.count({ where: { action: "TOLL_DATA_ALERT", reason: { contains: "failed" } } })).toBeGreaterThan(0);
    expect(await approvedRows("third-party")).toEqual(before);
  });

  it("rejects an invalid or reformatted source document and keeps existing rates", async () => {
    const before = await approvedRows("third-party");
    const reformatted = await runTollMonitor(prisma, { trigger: "weekly", fetchImpl: fakeFetch({ "https://example.test/robots.txt": ROBOTS_OK, "https://example.test/star": { body: "<main><p>New site design</p></main>" } }) });
    expect(reformatted.results[0].outcome).toBe("FAILED"); expect(reformatted.results[0].message).toMatch(/format may have changed/);
    const invalid = await stageMatrix(prisma, { sourceId: "third-party", sourceUrl: "x", content: "bad", rows: [{ ...july[0], tollCentavos: 0 }], actor: "test" });
    expect(invalid.outcome).toBe("INVALID");
    expect(await approvedRows("third-party")).toEqual(before);
  });

  it("flags a partial matrix as incomplete", async () => {
    const partial = await stageMatrix(prisma, { sourceId: "third-party", sourceUrl: "x", content: "partial-1", rows: july.slice(0, 3), actor: "test" });
    expect(partial.outcome).toBe("STAGED");
    const report = await prisma.rateChangeReport.findFirstOrThrow({ where: { matrixImportId: (partial as { importId: string }).importId } });
    expect(report.summary).toMatchObject({ complete: false, removed: 3 });
    await rejectImport(prisma, (partial as { importId: string }).importId, "test", "Partial matrix");
  });

  it("skips sources whose robots.txt forbids automated access", async () => {
    const result = await runTollMonitor(prisma, { trigger: "manual", fetchImpl: fakeFetch({ "https://example.test/robots.txt": { body: "User-agent: *\nDisallow: /", type: "text/plain" } }) });
    expect(result.results[0].outcome).toBe("SKIPPED");
  });

  it("never runs two monitor jobs at once", async () => {
    // Another run holds an unexpired lease.
    await prisma.tollDataSetting.create({ data: { key: MONITOR_LEASE_KEY, value: { owner: "other-run", until: new Date(Date.now() + 600_000).toISOString() } } });
    try { expect(await runTollMonitor(prisma, { trigger: "manual", fetchImpl: fakeFetch({}) })).toMatchObject({ skipped: true }); }
    finally { await prisma.tollDataSetting.delete({ where: { key: MONITOR_LEASE_KEY } }); }
    // An expired lease (a crashed run) does not block the next run, and the lease is released afterwards.
    await prisma.tollDataSetting.create({ data: { key: MONITOR_LEASE_KEY, value: { owner: "crashed-run", until: new Date(Date.now() - 60_000).toISOString() } } });
    expect(await runTollMonitor(prisma, { trigger: "manual", sourceIds: ["none"], fetchImpl: fakeFetch({}) })).toMatchObject({ skipped: false });
    expect(await prisma.tollDataSetting.findUnique({ where: { key: MONITOR_LEASE_KEY } })).toBeNull();
  });

  it("approves a proposed third-party import: it replaces the old one, which is kept as superseded", async () => {
    const pending = await prisma.matrixImport.findFirstOrThrow({ where: { sourceId: "third-party", status: "PENDING_REVIEW" } });
    await approveImport(prisma, pending.id, "test", "Matches TRB announcement");
    expect(await approvedRows("third-party")).toContain("Lipa→Batangas CLASS_1 5700");
    expect(await prisma.matrixImport.count({ where: { sourceId: "third-party", status: "EXPIRED" } })).toBe(1);
    await expect(approveImport(prisma, pending.id, "test")).rejects.toBeInstanceOf(ReviewError);
  });

  it("rejects a proposed import; it is never used", async () => {
    const proposal = await stageMatrix(prisma, { sourceId: "third-party", sourceUrl: "x", content: "typo", rows: star([["Sto. Tomas", "Lipa", [640, 128, 192]], ["Lipa", "Batangas", [57, 114, 171]]]), actor: "test" });
    const id = (proposal as { importId: string }).importId;
    await rejectImport(prisma, id, "test", "Typo in Class 1 fare");
    expect((await prisma.matrixImport.findUniqueOrThrow({ where: { id } })).status).toBe("REJECTED");
    expect(await approvedRows("third-party")).not.toContain("Sto. Tomas→Lipa CLASS_1 64000");
  });

  it("publishes official rates only with an effective date and known plazas, preserving history", async () => {
    const jan = await stageMatrix(prisma, { sourceId: "operator", sourceUrl: "https://operator.test/jan.pdf", content: "jan", rows: january, effectiveFrom: new Date("2026-01-01"), actor: "test" });
    await approveImport(prisma, (jan as { importId: string }).importId, "test");
    const undated = await stageMatrix(prisma, { sourceId: "operator", sourceUrl: "https://operator.test/x.pdf", content: "undated", rows: july, actor: "test" });
    await expect(approveImport(prisma, (undated as { importId: string }).importId, "test")).rejects.toThrow(/effective date/);
    await rejectImport(prisma, (undated as { importId: string }).importId, "test", "No effective date");
    const unknown = await stageMatrix(prisma, { sourceId: "operator", sourceUrl: "https://operator.test/y.pdf", content: "unknown", rows: star([["Sto. Tomas", "Ibaan", [97, 194, 291]]]), effectiveFrom: new Date("2026-07-01"), actor: "test" });
    await expect(approveImport(prisma, (unknown as { importId: string }).importId, "test")).rejects.toThrow(/no plaza record for Ibaan/);
    await rejectImport(prisma, (unknown as { importId: string }).importId, "test", "Unknown plaza");
    const jul = await stageMatrix(prisma, { sourceId: "operator", sourceUrl: "https://operator.test/jul.pdf", content: "jul", rows: july, effectiveFrom: new Date("2026-07-01"), actor: "test" });
    await approveImport(prisma, (jul as { importId: string }).importId, "test");
    const versions = await prisma.rateVersion.findMany({ orderBy: { versionNumber: "asc" }, include: { _count: { select: { rates: true } } } });
    expect(versions.map((version) => [version.versionNumber, version.status, version.effectiveFrom.toISOString().slice(0, 10), version.effectiveTo?.toISOString().slice(0, 10) ?? null, version._count.rates])).toEqual([[1, "PUBLISHED", "2026-01-01", "2026-07-01", 6], [2, "PUBLISHED", "2026-07-01", null, 6]]);
  });

  it("schedules a future-dated official matrix instead of applying it early", async () => {
    const future = await stageMatrix(prisma, { sourceId: "operator", sourceUrl: "https://operator.test/2030.pdf", content: "2030", rows: star([["Sto. Tomas", "Lipa", [70, 140, 210]], ["Lipa", "Batangas", [60, 120, 180]]]), effectiveFrom: new Date("2030-01-01"), actor: "test" });
    const result = await approveImport(prisma, (future as { importId: string }).importId, "test");
    expect((await prisma.rateVersion.findUniqueOrThrow({ where: { id: result.rateVersions[0] } })).status).toBe("SCHEDULED");
  });

  it("rolls back a publication: versions withdrawn, previous version and import restored", async () => {
    const latest = await prisma.matrixImport.findFirstOrThrow({ where: { sourceId: "operator", status: "PUBLISHED" } });
    const result = await rollbackImport(prisma, latest.id, "test", "Wrong document");
    expect(result.withdrawnVersions).toBe(1);
    const versions = await prisma.rateVersion.findMany({ orderBy: { versionNumber: "asc" } });
    expect(versions.map((version) => [version.versionNumber, version.status, version.effectiveTo?.toISOString().slice(0, 10) ?? null])).toEqual([[1, "PUBLISHED", "2026-07-01"], [2, "PUBLISHED", null], [3, "REJECTED", null]]);
    expect(await prisma.auditLog.count({ where: { action: "RATE_IMPORT_ROLLED_BACK" } })).toBe(1);
  });

  it("never auto-publishes without an effective date, even when the policy is enabled", async () => {
    await updateTollDataSettings(prisma, { autoPublishOfficial: true }, "test");
    await prisma.rateSource.update({ where: { id: "operator" }, data: { monitorEnabled: true } });
    const result = await runTollMonitor(prisma, { trigger: "manual", sourceIds: ["operator"], fetchImpl: fakeFetch({ "https://operator.test/robots.txt": ROBOTS_OK, "https://operator.test/star": { body: page(star([["Sto. Tomas", "Lipa", [66, 132, 198]], ["Lipa", "Batangas", [58, 116, 174]]])) } }) });
    expect(result.results[0].outcome).toBe("CHANGED");
    expect((await prisma.matrixImport.findUniqueOrThrow({ where: { id: result.results[0].importId! } })).status).toBe("PENDING_REVIEW");
    expect(await prisma.auditLog.count({ where: { action: "TOLL_DATA_ALERT", reason: { contains: "Auto-publication declined" } } })).toBe(1);
  });
});
