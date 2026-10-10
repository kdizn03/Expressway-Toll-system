/** Central, provider-independent aliases. Add road-name variants here, not in UI components. */
const aliases: Record<string, string[]> = {
  NLEX: ["nlex", "north luzon expressway", "northern luzon expressway"],
  SCTEX: ["sctex", "subic-clark-tarlac expressway", "subic clark tarlac expressway"],
  TPLEX: ["tplex", "tarlac-pangasinan-la union expressway", "tarlac pangasinan la union expressway"],
  NLEX_CONNECTOR: ["nlex connector", "nlex connector road"],
  SLEX: ["slex", "south luzon expressway"], SKYWAY: ["skyway", "skyway stage 3"],
  CALAX: ["calax", "cavite-laguna expressway", "cavite laguna expressway"],
  CAVITEX: ["cavitex", "manila-cavite expressway", "manila cavite expressway"],
  C5_LINK: ["c5 link", "c-5 link"], STAR: ["star tollway", "southern tagalog arterial road"],
  MCX: ["mcx", "muntinlupa-cavite expressway", "muntinlupa cavite expressway"], NAIAX: ["naiax", "naia expressway"],
};
const normalise = (value: string) => value.toLowerCase().replace(/[–—]/g, "-").replace(/[^a-z0-9]+/g, " ").trim();
export function identifyExpressway(...labels: Array<string | undefined>): string | undefined {
  const text = normalise(labels.filter(Boolean).join(" "));
  return Object.entries(aliases).find(([, names]) => names.some((name) => text.includes(normalise(name))))?.[0];
}
