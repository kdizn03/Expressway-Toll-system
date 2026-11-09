import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, sessionCookieName } from "@/lib/auth/session";
import { requireApiUser, unauthorized } from "@/lib/auth/guards";
import { verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { z } from "zod";

const deletionSchema = z.object({ password: z.string().max(128).optional(), confirmation: z.literal("DELETE_ACCOUNT") });
export async function DELETE(request: NextRequest) {
  const user = await requireApiUser();
  if (!user) return unauthorized();
  const parsed = deletionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Confirm account deletion to continue." }, { status: 400 });
  const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (account.passwordHash && (!parsed.data.password || !(await verifyPassword(parsed.data.password, account.passwordHash)))) return NextResponse.json({ message: "Your password is required to delete this account." }, { status: 400 });
  await prisma.user.delete({ where: { id: user.id } });
  const response = NextResponse.json({ message: "Your account and personal data were deleted." });
  if (request.cookies.get(sessionCookieName)?.value) clearSessionCookie(response);
  return response;
}
