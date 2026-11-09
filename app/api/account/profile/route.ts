import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, unauthorized } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { preferenceSchema, profileSchema } from "@/lib/validation";

export async function GET() {
  const user = await requireApiUser();
  if (!user) return unauthorized();
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true, fullName: true, email: true, role: true, emailVerifiedAt: true, preferences: true } });
  return NextResponse.json({ user: profile });
}

export async function PATCH(request: NextRequest) {
  const user = await requireApiUser();
  if (!user) return unauthorized();
  const body = await request.json().catch(() => null);
  const profile = profileSchema.safeParse(body);
  const preferences = preferenceSchema.safeParse(body?.preferences);
  if (!profile.success || (body?.preferences !== undefined && !preferences.success)) return NextResponse.json({ message: "Enter valid profile details." }, { status: 400 });
  const preferenceUpdate = body?.preferences === undefined ? undefined : preferences.data!;
  const updated = await prisma.user.update({
    where: { id: user.id }, data: { fullName: profile.data.fullName, preferences: preferenceUpdate ? { upsert: { create: preferenceUpdate, update: preferenceUpdate } } : undefined },
    select: { id: true, fullName: true, email: true, role: true, preferences: true },
  });
  return NextResponse.json({ user: updated });
}
