import { PrismaClient } from "@prisma/client";

// Tollway-aligned locator points for matrix matching. These deliberately use
// canonical matrix labels rather than ambiguous municipality geocodes (for
// example Balintawak in Cebu or Rosario in Batangas).
const plazas = {
  TPLEX: [["La Paz",15.4408,120.7284],["Victoria",15.5700,120.6200],["Gerona",15.6057,120.5992],["Paniqui",15.6685,120.5780],["Moncada",15.7352,120.5733],["Carmen",15.8260,120.5700],["Urdaneta",15.9758,120.5709],["Binalonan",16.0462,120.5912],["Pozorrubio",16.1099,120.5441],["Sison",16.1727,120.5099],["Rosario",16.2300,120.4860]],
  NLEX: [["Balintawak",14.6560,120.9970],["Mindanao Avenue",14.6820,121.0240],["Karuhatan",14.6861,120.9761],["Valenzuela",14.7000,120.9850],["Meycauayan",14.7463,120.9724],["Marilao",14.7547,120.9540],["Ciudad de Victoria",14.7995,120.9486],["Bocaue",14.7975,120.9292],["Tambubong",14.8060,120.9210],["Balagtas",14.8163,120.9095],["Sta. Rita",14.8490,120.8900],["Pulilan",14.9024,120.8490],["Tabang",14.8727,120.8616],["San Simon",14.9954,120.7792],["San Fernando",15.0278,120.6934],["Mexico",15.0646,120.7204],["Angeles",15.1389,120.5875],["Dau",15.1755,120.5878],["Sta. Ines",15.2150,120.5900]],
  SCTEX: [["Tipo/SFEX",14.8419,120.3541],["Dinalupihan",14.8694,120.4635],["Floridablanca",14.9743,120.5282],["Porac",15.0722,120.5422],["Clark South",15.1400,120.5600],["Mabalacat (Mabiga)",15.2133,120.5799],["Clark North",15.2500,120.5700],["Dolores",15.2700,120.5650],["Bamban (New Clark City)",15.3190,120.5667],["Concepcion",15.3246,120.6538],["San Miguel",15.4300,120.6400],["Tarlac",15.4872,120.5885]],
};
const prisma = new PrismaClient();
try {
  for (const [abbreviation, items] of Object.entries(plazas)) {
    const expressway = await prisma.expressway.findUniqueOrThrow({ where: { abbreviation } });
    for (const [name, latitude, longitude] of items) await prisma.tollPlaza.upsert({
      where: { expresswayId_name: { expresswayId: expressway.id, name } },
      update: { latitude, longitude, aliases: [name, "Canonical matrix locator"] },
      create: { expresswayId: expressway.id, name, latitude, longitude, aliases: [name, "Canonical matrix locator"] },
    });
  }
  console.log("Repaired canonical NLEX, SCTEX, and TPLEX plaza locators.");
} finally { await prisma.$disconnect(); }
