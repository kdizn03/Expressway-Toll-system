import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, unauthorized } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { Prisma } from "@prisma/client";

const tripSchema = z.object({ origin: z.string().trim().min(2).max(160), destination: z.string().trim().min(2).max(160), vehicleClass: z.enum(["CLASS_1", "CLASS_2", "CLASS_3"]).nullable().optional(), routeData: z.record(z.string(), z.unknown()).nullable().optional(), traveledAt: z.coerce.date().optional() });
export async function GET() {
  const user = await requireApiUser(); if (!user) return unauthorized();
  return NextResponse.json({ trips: await prisma.tripHistory.findMany({ where: { userId: user.id }, orderBy: { traveledAt: "desc" }, take: 50 }) });
}
export async function POST(request: NextRequest) {
  const user = await requireApiUser(); if (!user) return unauthorized(); const parsed = tripSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Enter valid trip details." }, { status: 400 });
  return NextResponse.json({ trip: await prisma.tripHistory.create({ data: { userId: user.id, ...parsed.data, routeData: parsed.data.routeData === null ? Prisma.JsonNull : parsed.data.routeData as Prisma.InputJsonValue } }) }, { status: 201 });
}
