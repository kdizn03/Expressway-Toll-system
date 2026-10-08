import { PrismaClient } from "@prisma/client";
const prisma=new PrismaClient();
async function main(){
  // Classes have no toll prices: official matrices must be imported and reviewed first.
  await Promise.all([['CLASS_1','Class 1','Passenger cars and light vehicles; access rules vary by tollway.'],['CLASS_2','Class 2','Medium commercial vehicles; verify tollway restrictions.'],['CLASS_3','Class 3','Heavy vehicles; verify tollway restrictions.']].map(([code,displayName,description])=>prisma.vehicleClass.upsert({where:{code},update:{displayName,description},create:{code,displayName,description}})));
}
main().finally(()=>prisma.$disconnect());
