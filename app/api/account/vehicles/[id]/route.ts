import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, unauthorized } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { vehicleProfileSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, { params }: Context) {
  const user = await requireApiUser(); if (!user) return unauthorized();
  const parsed = vehicleProfileSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ message: "Enter valid vehicle details." }, { status: 400 });
  const { id } = await params;
  const result = await prisma.vehicleProfile.updateMany({ where: { id, userId: user.id }, data: parsed.data });
  return result.count ? NextResponse.json({ message: "Vehicle updated." }) : NextResponse.json({ message: "Vehicle not found." }, { status: 404 });
}
export async function DELETE(_: NextRequest, { params }: Context) {
  const user = await requireApiUser(); if (!user) return unauthorized(); const { id } = await params;
  const result = await prisma.vehicleProfile.deleteMany({ where: { id, userId: user.id } });
  return result.count ? NextResponse.json({ message: "Vehicle removed." }) : NextResponse.json({ message: "Vehicle not found." }, { status: 404 });
}
