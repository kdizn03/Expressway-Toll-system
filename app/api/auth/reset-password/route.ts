import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { hashToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db";
import { resetPasswordSchema } from "@/lib/validation";
import { authenticationDisabledResponse, isAuthEnabled } from "@/lib/auth/config";

export async function POST(request: NextRequest) {
  if (!isAuthEnabled()) return authenticationDisabledResponse();
  const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Enter a valid new password." }, { status: 400 });
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(parsed.data.token) } });
  if (!record || record.expiresAt <= new Date()) {
    if (record) await prisma.passwordResetToken.delete({ where: { id: record.id } });
    return NextResponse.json({ message: "This reset link is invalid or has expired." }, { status: 400 });
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(parsed.data.password) } }),
    prisma.passwordResetToken.delete({ where: { id: record.id } }),
    prisma.authSession.deleteMany({ where: { userId: record.userId } }),
  ]);
  return NextResponse.json({ message: "Password reset. Please sign in." });
}
