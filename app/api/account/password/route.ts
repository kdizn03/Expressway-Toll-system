import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, unauthorized } from "@/lib/auth/guards";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { changePasswordSchema } from "@/lib/validation";

export async function PATCH(request: NextRequest) {
  const user = await requireApiUser();
  if (!user) return unauthorized();
  const parsed = changePasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Enter a valid password." }, { status: 400 });
  const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (account.passwordHash && (!parsed.data.currentPassword || !(await verifyPassword(parsed.data.currentPassword, account.passwordHash)))) return NextResponse.json({ message: "Your current password is incorrect." }, { status: 400 });
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.password) } }),
    prisma.authSession.deleteMany({ where: { userId: user.id } }),
  ]);
  return NextResponse.json({ message: "Password changed. Please sign in again." });
}
