import { z } from "zod";

/** One staged toll-matrix row, as produced by a parser or a manual import. */
export const matrixRowSchema = z.object({
  entryExpresswayCode: z.string().trim().min(1).max(40),
  exitExpresswayCode: z.string().trim().min(1).max(40),
  entryName: z.string().trim().min(1).max(120),
  exitName: z.string().trim().min(1).max(120),
  vehicleClassCode: z.enum(["CLASS_1", "CLASS_2", "CLASS_3"]),
  // Positive whole centavos only: a zero or missing fare is never treated as a toll.
  tollCentavos: z.number().int().positive().max(1_000_000),
  reversible: z.boolean().default(false),
});
export type MatrixRow = z.infer<typeof matrixRowSchema>;

export const rowKey = (row: Pick<MatrixRow, "entryExpresswayCode" | "exitExpresswayCode" | "entryName" | "exitName" | "vehicleClassCode">) =>
  `${row.entryExpresswayCode}|${row.exitExpresswayCode}|${row.entryName}|${row.exitName}|${row.vehicleClassCode}`;
const pairKey = (row: MatrixRow) => `${row.entryExpresswayCode}|${row.exitExpresswayCode}|${row.entryName}|${row.exitName}`;

export type MatrixValidation = {
  ok: boolean;
  /** Complete: every plaza pair has a fare for all three vehicle classes. Required for auto-publication. */
  complete: boolean;
  rows: MatrixRow[];
  errors: string[];
  warnings: string[];
};

/**
 * Validates a whole matrix before it can be staged or published. Errors block staging; warnings
 * (incomplete classes, a much smaller matrix than before) block automatic publication only.
 */
export function validateMatrix(input: unknown[], options: { minimumRows?: number; previousRowCount?: number } = {}): MatrixValidation {
  const errors: string[] = []; const warnings: string[] = []; const rows: MatrixRow[] = [];
  let samePlaza = 0;
  input.forEach((candidate, index) => {
    const parsed = matrixRowSchema.safeParse(candidate);
    // A row whose entry and exit are the same plaza cannot be priced; skip it rather than reject the matrix.
    if (parsed.success && parsed.data.entryExpresswayCode === parsed.data.exitExpresswayCode && parsed.data.entryName === parsed.data.exitName) { samePlaza++; return; }
    if (parsed.success) rows.push(parsed.data); else errors.push(`Row ${index + 1}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "row"} ${issue.message}`).join("; ")}`);
  });
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = rowKey(row); const previous = seen.get(key);
    if (previous !== undefined && previous !== row.tollCentavos) errors.push(`Conflicting fares for ${key.replace(/\|/g, " / ")}: ₱${previous / 100} and ₱${row.tollCentavos / 100}.`);
    seen.set(key, row.tollCentavos);
  }
  if (samePlaza > 0) warnings.push(`${samePlaza} row(s) with the same entry and exit plaza were skipped.`);
  if (rows.length < (options.minimumRows ?? 1)) errors.push(`Only ${rows.length} valid rows; at least ${options.minimumRows ?? 1} expected. The source format may have changed.`);
  if (options.previousRowCount && rows.length < options.previousRowCount * 0.8) warnings.push(`Partial matrix: ${rows.length} rows versus ${options.previousRowCount} in the version currently in use.`);
  const classesByPair = new Map<string, Set<string>>();
  for (const row of rows) { const key = pairKey(row); classesByPair.set(key, (classesByPair.get(key) ?? new Set()).add(row.vehicleClassCode)); }
  const incompletePairs = [...classesByPair.values()].filter((classes) => classes.size < 3).length;
  if (incompletePairs > 0) warnings.push(`${incompletePairs} plaza pair(s) lack a fare for one or more vehicle classes.`);
  return { ok: errors.length === 0, complete: errors.length === 0 && incompletePairs === 0 && warnings.length === 0, rows, errors, warnings };
}
