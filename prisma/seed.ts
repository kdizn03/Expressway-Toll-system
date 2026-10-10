import { PrismaClient } from "@prisma/client";
const prisma=new PrismaClient();
async function main(){
  // Registry records intentionally contain no toll prices. Published pricing must cite an official source.
  await Promise.all([
    ["NLEX", "North Luzon Expressway"], ["SCTEX", "Subic–Clark–Tarlac Expressway"], ["TPLEX", "Tarlac–Pangasinan–La Union Expressway"],
    ["NLEX_CONNECTOR", "NLEX Connector"], ["SLEX", "South Luzon Expressway"], ["SKYWAY", "Skyway"], ["CALAX", "Cavite–Laguna Expressway"],
    ["CAVITEX", "Manila–Cavite Expressway"], ["C5_LINK", "C5 Link Expressway"], ["STAR", "Southern Tagalog Arterial Road"], ["MCX", "Muntinlupa–Cavite Expressway"], ["NAIAX", "NAIA Expressway"],
  ].map(([abbreviation, name]) => prisma.expressway.upsert({ where: { abbreviation }, update: { name }, create: { abbreviation, name } })));
  // Classes have no toll prices: official matrices must be imported and reviewed first.
  await Promise.all([['CLASS_1','Class 1','Passenger cars and light vehicles; access rules vary by tollway.'],['CLASS_2','Class 2','Medium commercial vehicles; verify tollway restrictions.'],['CLASS_3','Class 3','Heavy vehicles; verify tollway restrictions.']].map(([code,displayName,description])=>prisma.vehicleClass.upsert({where:{code},update:{displayName,description},create:{code,displayName,description}})));
}
main().finally(()=>prisma.$disconnect());
