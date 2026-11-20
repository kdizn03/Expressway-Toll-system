/** Central, provider-independent aliases. Add road-name variants here, not in UI components. */
const aliases: Record<string, string[]> = {
  NLEX: ["nlex", "north luzon expressway", "northern luzon expressway"],
  SCTEX: ["sctex", "subic-clark-tarlac expressway", "subic clark tarlac expressway"],
  TPLEX: ["tplex", "tarlac-pangasinan-la union expressway", "tarlac pangasinan la union expressway"],
  NLEX_CONNECTOR: ["nlex connector", "nlex connector road", "nlex-slex connector road", "nlex slex connector road"],
  SLEX: ["slex", "south luzon expressway"], SKYWAY: ["skyway", "skyway stage 3"],
  CALAX: ["calax", "cavite-laguna expressway", "cavite laguna expressway"],
  CAVITEX: ["cavitex", "manila-cavite expressway", "manila cavite expressway"],
  C5_LINK: ["c5 link", "c-5 link"], STAR: ["star tollway", "southern tagalog arterial road"],
  MCX: ["mcx", "muntinlupa-cavite expressway", "muntinlupa cavite expressway"], NAIAX: ["naiax", "naia expressway"],
};
/** Map providers abbreviate road names ("N Luzon Expy", "La Un", "Rd"); expand them before matching. */
const abbreviations: Array<[RegExp, string]> = [
  [/\b(expy|expwy|exwy|xway)\b/g, "expressway"],
  [/\brd\b/g, "road"],
  [/\bla un\b/g, "la union"],
  [/\bn luzon\b/g, "north luzon"],
  [/\bs luzon\b/g, "south luzon"],
];
const normalise = (value: string) => abbreviations.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value.toLowerCase().replace(/[–—]/g, "-").replace(/[^a-z0-9]+/g, " ").trim());
export function identifyExpressway(...labels: Array<string | undefined>): string | undefined {
  const text = normalise(labels.filter(Boolean).join(" "));
  const matches = Object.entries(aliases).flatMap(([code, names]) => names.filter((name) => text.includes(normalise(name))).map((name) => ({ code, length: normalise(name).length })));
  return matches.sort((a, b) => b.length - a.length)[0]?.code;
}
