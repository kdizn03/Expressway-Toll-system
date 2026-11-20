const canonicalNames: Record<string, Record<string, string>> = {
  TPLEX: { "Pozorrubbio": "Pozorrubio", "Rosario/Baguio": "Rosario" },
  NLEX: { "Mindanao Ave.": "Mindanao Avenue" },
  // "Tipo" is the published-rate plaza name; the matrices call the same plaza "Tipo/SFEX".
  SCTEX: { "Bamban/New Clark City": "Bamban (New Clark City)", "Tipo/Subic": "Tipo/SFEX", "Tipo": "Tipo/SFEX", "Hacienda Luisita": "San Miguel" },
};

export function canonicalMatrixPlaza(expressway: string, name: string) {
  return canonicalNames[expressway]?.[name] ?? name;
}
