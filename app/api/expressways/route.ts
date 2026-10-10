import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const expressways = await prisma.expressway.findMany({ where: { status: "operational" }, select: { id: true, abbreviation: true, name: true, operator: true, lastVerifiedAt: true }, orderBy: { name: "asc" } });
  return NextResponse.json(expressways);
}
