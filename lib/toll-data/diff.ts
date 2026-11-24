import { rowKey, type MatrixRow } from "./validation";

export type RateChange = { key: string; entry: string; exit: string; expressway: string; vehicleClass: string; fromCentavos?: number; toCentavos?: number };
export type MatrixDiff = {
  summary: { added: number; removed: number; changed: number; unchanged: number; plazasAdded: number; plazasRemoved: number; classesAdded: string[]; classesRemoved: string[]; hasChanges: boolean };
  changed: RateChange[]; added: RateChange[]; removed: RateChange[]; plazasAdded: string[]; plazasRemoved: string[];
};

const describe = (row: MatrixRow): Omit<RateChange, "fromCentavos" | "toCentavos"> => ({ key: rowKey(row), entry: `${row.entryExpresswayCode}:${row.entryName}`, exit: `${row.exitExpresswayCode}:${row.exitName}`, expressway: row.entryExpresswayCode === row.exitExpresswayCode ? row.entryExpresswayCode : `${row.entryExpresswayCode}→${row.exitExpresswayCode}`, vehicleClass: row.vehicleClassCode });
const plazasOf = (rows: MatrixRow[]) => new Set(rows.flatMap((row) => [`${row.entryExpresswayCode}:${row.entryName}`, `${row.exitExpresswayCode}:${row.exitName}`]));
const classesOf = (rows: MatrixRow[]) => new Set(rows.map((row) => row.vehicleClassCode));

/** Structured difference between the matrix in use (baseline) and a proposed one. */
export function diffMatrices(baseline: MatrixRow[], proposed: MatrixRow[]): MatrixDiff {
  const before = new Map(baseline.map((row) => [rowKey(row), row]));
  const after = new Map(proposed.map((row) => [rowKey(row), row]));
  const changed: RateChange[] = []; const added: RateChange[] = []; const removed: RateChange[] = []; let unchanged = 0;
  for (const [key, row] of after) {
    const old = before.get(key);
    if (!old) added.push({ ...describe(row), toCentavos: row.tollCentavos });
    else if (old.tollCentavos !== row.tollCentavos) changed.push({ ...describe(row), fromCentavos: old.tollCentavos, toCentavos: row.tollCentavos });
    else unchanged++;
  }
  for (const [key, row] of before) if (!after.has(key)) removed.push({ ...describe(row), fromCentavos: row.tollCentavos });
  const oldPlazas = plazasOf(baseline), newPlazas = plazasOf(proposed);
  const plazasAdded = [...newPlazas].filter((plaza) => !oldPlazas.has(plaza)).sort();
  const plazasRemoved = [...oldPlazas].filter((plaza) => !newPlazas.has(plaza)).sort();
  const oldClasses = classesOf(baseline), newClasses = classesOf(proposed);
  const classesAdded = [...newClasses].filter((code) => !oldClasses.has(code)).sort();
  const classesRemoved = baseline.length === 0 ? [] : [...oldClasses].filter((code) => !newClasses.has(code)).sort();
  return {
    summary: { added: added.length, removed: removed.length, changed: changed.length, unchanged, plazasAdded: plazasAdded.length, plazasRemoved: plazasRemoved.length, classesAdded, classesRemoved, hasChanges: added.length + removed.length + changed.length > 0 },
    changed, added, removed, plazasAdded, plazasRemoved,
  };
}
