import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, unauthorized } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { vehicleProfileSchema } from "@/lib/validation";

export async function GET() {
  const user = await requireApiUser(); if (!user) return unauthorized();
  return NextResponse.json({ vehicles: await prisma.vehicleProfile.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }) });
}
export async function POST(request: NextRequest) {
  const user = await requireApiUser(); if (!user) return unauthorized();
  const parsed = vehicleProfileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Enter valid vehicle details." }, { status: 400 });
  try { return NextResponse.json({ vehicle: await prisma.vehicleProfile.create({ data: { userId: user.id, ...parsed.data } }) }, { status: 201 }); }
  catch { return NextResponse.json({ message: "A vehicle with that name already exists." }, { status: 409 }); }
}
