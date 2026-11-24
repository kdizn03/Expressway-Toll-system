import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { distanceKm, nameKeys, normalizePlazaName, positionAlongCorridorKm, suspectReason, verifyPlaza, type Booth, type Corridor } from "../lib/toll-data/plaza-verification";
import { validateMatrix, type MatrixRow } from "../lib/toll-data/validation";
import { diffMatrices } from "../lib/toll-data/diff";
import { parseExpresswayPhMatrix, runParser } from "../lib/toll-data/parsers";
import { retryDelayHours, robotsAllows } from "../lib/toll-data/monitor";
import { announcementSchema, compareWithAnnouncement } from "../lib/toll-data/announcements";
import { findDuplicatePlazas } from "../lib/toll-data/quality";
import { usablePlazas } from "../lib/toll/plaza-coverage";
import { skywayStageSplit } from "../lib/toll/skyway-stages";
import type { LngLat } from "../lib/geo/polygon";

// Real evidence: named OpenStreetMap toll booths saved with the project (ODbL).
const evidence = JSON.parse(readFileSync("data/evidence/osm-toll-booths-2026-11-21.json", "utf8")) as { booths: Booth[] };
const booths = (name: string) => evidence.booths.filter((booth) => booth.name === name);
const centroid = (items: Booth[]): LngLat => [items.reduce((s, b) => s + b.lon, 0) / items.length, items.reduce((s, b) => s + b.lat, 0) / items.length];
// A stand-in road line through the STAR booths (north to south) for corridor tests.
const starLine: Corridor = [["Santo Tomas", "Tanauan City", "Malvar", "Santo Toribio", "Lipa City", "Ibaan", "Batangas City Toll Plaza"].map((name) => centroid(booths(name)))];
const anyOperator = () => true;

describe("plaza name normalisation", () => {
  it("treats common spelling variants as the same plaza", () => {
    expect(normalizePlazaName("Santo Tomas")).toBe(normalizePlazaName("Sto. Tomas"));
    expect(normalizePlazaName("Batangas City Toll Plaza")).toBe(normalizePlazaName("Batangas"));
    expect(normalizePlazaName("Laguna Blvd.")).toBe(normalizePlazaName("Laguna Boulevard"));
    expect(normalizePlazaName("Bocaue Toll Plaza A")).toBe("bocaue");
    expect(normalizePlazaName("Dau Southbound Exit")).toBe("dau");
  });
  it("lets either part of an 'A/B' rated name identify the plaza", () => {
    expect([...nameKeys("Bacoor/Zapote")]).toEqual(expect.arrayContaining(["bacoor", "zapote"]));
  });
});

describe("plaza location verification", () => {
  it("verifies STAR's Lipa plaza from named booths on the STAR road", () => {
    const result = verifyPlaza("Lipa", evidence.booths, starLine, (operator) => !operator || /star/i.test(operator));
    expect(result.status).toBe("VERIFIED_GEODATA");
    if (result.status === "VERIFIED_GEODATA") expect(distanceKm(result.coordinate, centroid(booths("Lipa City")))).toBeLessThan(0.01);
  });
  it("refuses booths that are far from the expressway's road", () => {
    expect(verifyPlaza("Dau", evidence.booths, starLine, anyOperator).status).toBe("NEEDS_REVIEW");
  });
  it("refuses booths with a conflicting operator", () => {
    expect(verifyPlaza("Calamba", evidence.booths, starLine, (operator) => !operator || /star/i.test(operator)).status).toBe("NEEDS_REVIEW");
  });
  it("leaves names with no booth unresolved instead of guessing", () => {
    expect(verifyPlaza("NAIA Terminal 3", evidence.booths, starLine, anyOperator)).toMatchObject({ status: "UNRESOLVED" });
  });
  it("rejects a name shared by booths kilometres apart", () => {
    const spread: Booth[] = [{ osm: "a", lat: 14.10, lon: 121.14, name: "Twin" }, { osm: "b", lat: 14.06, lon: 121.14, name: "Twin" }];
    const line: Corridor = [[[121.14, 14.2], [121.14, 13.9]]];
    expect(verifyPlaza("Twin", spread, line, anyOperator).status).toBe("NEEDS_REVIEW");
  });
  it("orders plazas along the road (sequence validation: STAR runs Sto. Tomas → Batangas)", () => {
    const order = ["Tanauan City", "Malvar", "Santo Toribio", "Lipa City", "Ibaan", "Batangas City Toll Plaza"].map((name) => positionAlongCorridorKm(centroid(booths(name)), starLine));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order.at(-1)! - order[0]).toBeGreaterThan(25);
  });
});

describe("plaza record checks", () => {
  it("flags off-Luzon and stacked (failed geocode) locators as invalid, far-from-road ones for review", () => {
    expect(suspectReason({ latitude: 8.558, longitude: 123.645 }, 1, [])?.severity).toBe("invalid");
    expect(suspectReason({ latitude: 18.303, longitude: 121.594 }, 6, [])?.severity).toBe("invalid");
    expect(suspectReason({ latitude: 14.30, longitude: 121.30 }, 1, starLine)?.severity).toBe("review");
    expect(suspectReason(centroid(booths("Malvar")).slice().reverse().reduce((p, v, i) => ({ ...p, [i ? "longitude" : "latitude"]: v }), {} as { latitude: number; longitude: number }), 1, starLine)).toBeUndefined();
  });
  it("ignores locators outside Luzon and keeps valid ones", () => {
    expect(usablePlazas([{ latitude: 14.656, longitude: 120.997 }, { latitude: 9.02, longitude: 125.52 }])).toHaveLength(1);
  });
  it("detects duplicate plazas by normalised name or identical location", () => {
    expect(findDuplicatePlazas([{ name: "Pozorrubio", latitude: 16.13, longitude: 120.526 }, { name: "Sto. Tomas", latitude: 14.127, longitude: 121.14 }, { name: "Santo Tomas", latitude: 14.2, longitude: 121.1 }, { name: "Greenfield", latitude: 14.2919, longitude: 121.068 }, { name: "Greenfield/Mamplasan", latitude: 14.29191, longitude: 121.06801 }]).map((item) => item.reason)).toEqual(["Same normalised name", "Same location (< 50 m)"]);
  });
  it("splits Skyway sections at Buendia between Stage 3 and Stages 1–2", () => {
    expect(skywayStageSplit([121.0, 14.6], [121.045, 14.43])).toBeDefined();
    expect(skywayStageSplit([121.04, 14.5], [121.045, 14.43])).toBeUndefined();
    expect(skywayStageSplit([120.9996, 14.5806], [121.045, 14.43])).toBeDefined(); // from Plaza Dilao
  });
});

const row = (entryName: string, exitName: string, vehicleClassCode: MatrixRow["vehicleClassCode"], pesos: number, code = "STAR"): MatrixRow => ({ entryExpresswayCode: code, exitExpresswayCode: code, entryName, exitName, vehicleClassCode, tollCentavos: pesos * 100, reversible: true });
const allClasses = (entry: string, exit: string, [c1, c2, c3]: number[]) => [row(entry, exit, "CLASS_1", c1), row(entry, exit, "CLASS_2", c2), row(entry, exit, "CLASS_3", c3)];

describe("matrix validation", () => {
  // STAR July 2026 fares as reported from the TRB announcement.
  const star = [...allClasses("Sto. Tomas", "Lipa", [64, 128, 192]), ...allClasses("Lipa", "Batangas", [57, 114, 171])];
  it("accepts a complete matrix for all vehicle classes", () => {
    expect(validateMatrix(star)).toMatchObject({ ok: true, complete: true, errors: [] });
  });
  it("rejects zero, negative, fractional fares and unknown vehicle classes", () => {
    const result = validateMatrix([{ ...star[0], tollCentavos: 0 }, { ...star[1], tollCentavos: -5 }, { ...star[2], tollCentavos: 12.5 }, { ...star[3], vehicleClassCode: "CLASS_4" }]);
    expect(result.ok).toBe(false);
    expect(result.errors.filter((error) => error.startsWith("Row "))).toHaveLength(4);
    expect(result.errors.join(" ")).toMatch(/source format may have changed/); // no valid rows left at all
  });
  it("rejects conflicting fares for the same pair and class", () => {
    expect(validateMatrix([...star, { ...star[0], tollCentavos: 6500 }]).errors[0]).toMatch(/Conflicting fares/);
  });
  it("skips rows whose entry and exit are the same plaza, with a warning", () => {
    const result = validateMatrix([...star, row("Lipa", "Lipa", "CLASS_1", 10)]);
    expect(result.ok).toBe(true); expect(result.rows).toHaveLength(6); expect(result.warnings[0]).toMatch(/same entry and exit/);
  });
  it("marks matrices missing a vehicle class as incomplete (blocks automatic publication)", () => {
    const result = validateMatrix(star.slice(0, 5));
    expect(result).toMatchObject({ ok: true, complete: false });
  });
  it("flags a partial matrix and a matrix far below the expected size", () => {
    expect(validateMatrix(star, { previousRowCount: 60 }).warnings.join(" ")).toMatch(/Partial matrix/);
    expect(validateMatrix(star, { minimumRows: 100 }).ok).toBe(false);
  });
});

describe("change detection", () => {
  // CAVITEX R1 Extension: ₱88/176/264 (Oct 2025) → ₱103/207/310 (TRB-approved, effective 28 Oct 2026).
  const before = allClasses("Bacoor/Zapote", "Kawit", [88, 176, 264]).map((item) => ({ ...item, entryExpresswayCode: "CAVITEX", exitExpresswayCode: "CAVITEX" }));
  const after = allClasses("Bacoor/Zapote", "Kawit", [103, 207, 310]).map((item) => ({ ...item, entryExpresswayCode: "CAVITEX", exitExpresswayCode: "CAVITEX" }));
  it("reports changed fares with old and new amounts", () => {
    const diff = diffMatrices(before, after);
    expect(diff.summary).toMatchObject({ changed: 3, added: 0, removed: 0, hasChanges: true });
    expect(diff.changed.map((change) => [change.fromCentavos, change.toCentavos])).toEqual([[8800, 10300], [17600, 20700], [26400, 31000]]);
  });
  it("reports added and removed plazas and vehicle classes", () => {
    const diff = diffMatrices([...before, row("A", "B", "CLASS_1", 10)], [...after.slice(0, 2), row("C", "D", "CLASS_1", 10)]);
    expect(diff.summary).toMatchObject({ added: 1, removed: 2 });
    expect(diff.plazasAdded).toEqual(["STAR:C", "STAR:D"]); expect(diff.plazasRemoved).toEqual(["STAR:A", "STAR:B"]);
    expect(diff.summary.classesRemoved).toEqual(["CLASS_3"]);
  });
  it("reports no changes for an identical matrix (no duplicate import)", () => {
    expect(diffMatrices(before, before).summary.hasChanges).toBe(false);
  });
});

describe("source parsers and monitor rules", () => {
  const page = `<main><h2>Class 1</h2><table><thead><tr><th>Exit \\ Entry</th><th>Sto. Tomas</th><th>Lipa</th></tr></thead><tbody><tr><td>Lipa</td><td>₱64</td><td>—</td></tr><tr><td>Batangas</td><td>₱121</td><td>₱57</td></tr></tbody></table>
<h2>Class 2</h2><table><thead><tr><th>x</th><th>Sto. Tomas</th></tr></thead><tbody><tr><td>Lipa</td><td>₱128</td></tr></tbody></table>
<h2>Class 3</h2><table><thead><tr><th>x</th><th>Sto. Tomas</th></tr></thead><tbody><tr><td>Lipa</td><td>₱1,192.50</td></tr></tbody></table></main>`;
  it("parses an ExpresswayPH-format page into per-class rows", () => {
    const rows = parseExpresswayPhMatrix(page, (name) => ({ code: "STAR", name }));
    expect(rows.map((item) => `${item.vehicleClassCode} ${item.entryName}→${item.exitName} ${item.tollCentavos}`)).toEqual(["CLASS_1 Sto. Tomas→Lipa 6400", "CLASS_1 Sto. Tomas→Batangas 12100", "CLASS_1 Lipa→Batangas 5700", "CLASS_2 Sto. Tomas→Lipa 12800", "CLASS_3 Sto. Tomas→Lipa 119250"]);
  });
  it("fails safely when a page format changes", () => {
    expect(() => runParser("expressway-ph:STAR", "<main><h2>Rates</h2></main>")).toThrow(/format may have changed/);
    expect(() => runParser("toll-ph", "<html>nothing</html>")).toThrow(/format may have changed/);
    expect(() => runParser("unknown-parser", "")).toThrow(/Unknown parser/);
    expect(runParser("document-hash", "anything")).toBeUndefined();
  });
  it("respects robots.txt", () => {
    expect(robotsAllows("User-agent: *\nDisallow: /", "/news-and-events/")).toBe(false);
    expect(robotsAllows("User-agent: *\nAllow: /\nDisallow: /api", "/matrix")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /api", "/api/rates")).toBe(false);
    expect(robotsAllows("User-agent: SomeBot\nDisallow: /\n\nUser-agent: *\nAllow: /", "/matrix")).toBe(true);
    expect(robotsAllows("", "/anything")).toBe(true);
  });
  it("backs off retries after failures, capped at a day", () => {
    expect([1, 2, 3, 4, 6, 10].map((failures) => retryDelayHours(failures, 24))).toEqual([1, 2, 4, 8, 24, 24]);
    expect(retryDelayHours(5, 6)).toBe(6);
  });
});

describe("TRB announcement cross-checks", () => {
  const effective = new Date("2026-07-01");
  it("verifies matching rows, supersedes stale third-party rows, and flags official conflicts", () => {
    const now = new Date("2026-11-21");
    expect(compareWithAnnouncement({ tollCentavos: 13700, official: false }, 13700, effective, now)).toBe("VERIFIED");
    expect(compareWithAnnouncement({ tollCentavos: 12600, official: false }, 13700, effective, now)).toBe("SUPERSEDED");
    expect(compareWithAnnouncement({ tollCentavos: 12600, official: true }, 13700, effective, now)).toBe("CONFLICT");
    expect(compareWithAnnouncement({ tollCentavos: 12600, official: false }, 13700, effective, new Date("2026-06-01"))).toBe("NOT_YET_EFFECTIVE");
  });
  it("keeps every recorded announcement well-formed and sourced", () => {
    const file = JSON.parse(readFileSync("data/toll-rate-announcements.json", "utf8")) as { announcements: unknown[] };
    const parsed = file.announcements.map((item) => announcementSchema.parse(item));
    expect(parsed.length).toBeGreaterThan(0);
    for (const announcement of parsed) { expect(Object.keys(announcement.fares).sort()).toEqual(["CLASS_1", "CLASS_2", "CLASS_3"]); expect(announcement.sources.length).toBeGreaterThan(0); }
  });
});

describe("Skyway/SLEX hand-over", () => {
  it("starts the SLEX section at the shared plaza where the Skyway section ended", async () => {
    const { continueAtHandover } = await import("../lib/toll/route-matcher-handover");
    const matches = continueAtHandover([{ expressway: "SKYWAY", entry: "Buendia", exit: "Alabang", confidence: "HIGH" }, { expressway: "SLEX", entry: "Filinvest", exit: "Sto. Tomas", confidence: "HIGH" }, { expressway: "STAR", entry: "Sto. Tomas", exit: "Batangas", confidence: "HIGH" }], new Set(["Alabang", "Sucat"]));
    expect(matches.map((match) => `${match.expressway} ${match.entry}→${match.exit}`)).toEqual(["SKYWAY Buendia→Alabang", "SLEX Alabang→Sto. Tomas", "STAR Sto. Tomas→Batangas"]);
  });
});
