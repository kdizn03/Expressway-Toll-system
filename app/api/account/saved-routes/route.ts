import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, unauthorized } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { savedRouteSchema } from "@/lib/validation";
import { Prisma } from "@prisma/client";

export async function GET() {
  const user = await requireApiUser(); if (!user) return unauthorized();
  return NextResponse.json({ routes: await prisma.savedRoute.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }) });
}
export async function POST(request: NextRequest) {
  const user = await requireApiUser(); if (!user) return unauthorized();
  const parsed = savedRouteSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ message: "Enter valid route details." }, { status: 400 });
  try { return NextResponse.json({ route: await prisma.savedRoute.create({ data: { userId: user.id, ...parsed.data, routeData: parsed.data.routeData === null ? Prisma.JsonNull : parsed.data.routeData as Prisma.InputJsonValue } }) }, { status: 201 }); }
  catch { return NextResponse.json({ message: "A saved route with that name already exists." }, { status: 409 }); }
}
