import { parseTollPhMatrix } from "../toll-import/toll-ph.js";
import type { MatrixRow } from "./validation";

/**
 * Source parsers, selected by RateSource.parser. A parser returns raw rows; validation and
 * change detection happen in the monitor. "document-hash" sources have no parser: a change only
 * raises a review alert (used for official documents that must be read by a person).
 */
const clean = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/&nbsp;| /g, " ").replace(/&amp;/g, "&").replace(/&#8211;|&ndash;/g, "–").replace(/\s+/g, " ").trim();
const parseFee = (value: string) => { const match = clean(value).match(/(?:₱\s*)?([\d,]+(?:\.\d{1,2})?)$/); return match ? Math.round(Number(match[1].replace(/,/g, "")) * 100) : undefined; };

/** ExpresswayPH expressway pages: one entry/exit table per vehicle class. */
export function parseExpresswayPhMatrix(html: string, codeFor: (name: string) => { code: string; name: string }): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const vehicleClass of [1, 2, 3]) {
    const start = html.lastIndexOf(`>Class ${vehicleClass}<`);
    const end = vehicleClass === 3 ? html.indexOf("</main>", start) : html.lastIndexOf(`>Class ${vehicleClass + 1}<`);
    if (start < 0 || end < 0) throw new Error(`Class ${vehicleClass} table not found; the page format may have changed.`);
    const table = html.slice(start, end);
    const headers = [...(table.match(/<thead[\s\S]*?<\/thead>/)?.[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g) ?? [])].map((item) => clean(item[1])).slice(1);
    const body = table.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? "";
    for (const row of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row[1].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/g)].map((item) => item[1]);
      const exit = clean(cells[0] ?? "");
      cells.slice(1).forEach((cell, index) => {
        const tollCentavos = parseFee(cell); const entry = headers[index];
        if (!tollCentavos || !entry || !exit) return;
        const from = codeFor(entry), to = codeFor(exit);
        rows.push({ entryExpresswayCode: from.code, exitExpresswayCode: to.code, entryName: from.name, exitName: to.name, vehicleClassCode: `CLASS_${vehicleClass}` as MatrixRow["vehicleClassCode"], tollCentavos, reversible: true });
      });
    }
  }
  return rows;
}

export type ParserResult = { rows: MatrixRow[]; reportedUpdatedAt?: Date | null; minimumRows: number };

/** Parser ids: "toll-ph", "expressway-ph:<CODE>", "expressway-ph-nlex-sctex", "document-hash". */
export function runParser(parser: string, content: string): ParserResult | undefined {
  if (parser === "document-hash") return undefined;
  if (parser === "toll-ph") { const parsed = parseTollPhMatrix(content, { minimumRows: 100 }); return { rows: parsed.rows as MatrixRow[], reportedUpdatedAt: parsed.reportedUpdatedAt, minimumRows: 100 }; }
  if (parser === "expressway-ph-nlex-sctex") return { rows: parseExpresswayPhMatrix(content, (name) => name.startsWith("SCTEX") ? { code: "SCTEX", name: name.replace(/^SCTEX /, "") } : { code: "NLEX", name }), minimumRows: 500 };
  const single = parser.match(/^expressway-ph:([A-Z_0-9]+)$/);
  if (single) return { rows: parseExpresswayPhMatrix(content, (name) => ({ code: single[1], name })), minimumRows: 3 };
  throw new Error(`Unknown parser "${parser}".`);
}
