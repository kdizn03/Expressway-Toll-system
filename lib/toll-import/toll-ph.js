import { createHash } from "node:crypto";

export const TOLL_PH_MATRIX_URL = "https://toll.ph/matrix";

// This is Svelte's serialized route data, not an undocumented JSON API. Keeping
// the parser deliberately strict makes a markup/data-shape change fail safely.
const MATRIX_RECORD = /toll_matrix:\{entryPointId:(?<entryId>\d+),exitPointId:(?<exitId>\d+),fee:"(?<fee>[\d.]+)",reversible:(?<reversible>true|false),vehicleClass:(?<vehicleClass>[123])\},entryPoint:\{id:\k<entryId>,name:"(?<entryName>[^"]+)",keywords:(?:null|\[[^\]]*\]),expresswayId:"(?<entryExpresswayCode>[^"]+)"[^}]*\},exitPoint:\{id:\k<exitId>,name:"(?<exitName>[^"]+)",keywords:(?:null|\[[^\]]*\]),expresswayId:"(?<exitExpresswayCode>[^"]+)"/g;

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseReportedUpdatedAt(html) {
  const text = decodeHtml(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
  const match = text.match(/Last updated:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/i);
  if (!match) return null;
  const parsed = new Date(`${match[1]} UTC`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Returns every class-1/2/3 source row. It intentionally does not expand
 * reversible rows: that is a reviewer decision, not an assumption.
 */
export function parseTollPhMatrix(html, { minimumRows = 100 } = {}) {
  const rows = [];
  for (const match of html.matchAll(MATRIX_RECORD)) {
    const { groups } = match;
    const fee = Number(groups.fee);
    // Zero must be explicitly represented as a free segment in a source before
    // it can become a displayed rate; the public matrix has no such flag.
    if (!Number.isFinite(fee) || fee <= 0) continue;
    rows.push({
      entryExpresswayCode: decodeHtml(groups.entryExpresswayCode),
      exitExpresswayCode: decodeHtml(groups.exitExpresswayCode),
      entryName: decodeHtml(groups.entryName),
      exitName: decodeHtml(groups.exitName),
      vehicleClassCode: `CLASS_${groups.vehicleClass}`,
      tollCentavos: Math.round(fee * 100),
      reversible: groups.reversible === "true",
    });
  }

  if (rows.length < minimumRows) {
    throw new Error(`Toll.ph matrix parser found only ${rows.length} rows; the source format may have changed.`);
  }

  return { rows, reportedUpdatedAt: parseReportedUpdatedAt(html) };
}

export async function fetchTollPhMatrix() {
  const response = await fetch(TOLL_PH_MATRIX_URL, {
    headers: { "User-Agent": "LuzonTollmap/1.0 matrix-review-importer" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Toll.ph matrix request failed with HTTP ${response.status}.`);

  const html = await response.text();
  const contentHash = createHash("sha256").update(html).digest("hex");
  return { ...parseTollPhMatrix(html), contentHash };
}
