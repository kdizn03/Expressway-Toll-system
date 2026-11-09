import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, unauthorized } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser(); if (!user) return unauthorized(); const { id } = await params;
  const result = await prisma.savedRoute.deleteMany({ where: { id, userId: user.id } });
  return result.count ? NextResponse.json({ message: "Saved route removed." }) : NextResponse.json({ message: "Saved route not found." }, { status: 404 });
}
