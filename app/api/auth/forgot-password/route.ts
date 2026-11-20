import { NextRequest, NextResponse } from "next/server";
import { canDeliverEmail, deliverEmail, appUrl } from "@/lib/auth/email";
import { issuePasswordResetToken } from "@/lib/auth/account-service";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { rateLimitKey } from "@/lib/auth/request";
import { prisma } from "@/lib/db";
import { forgotPasswordSchema } from "@/lib/validation";
import { authenticationDisabledResponse, isAuthEnabled } from "@/lib/auth/config";

const generic = { message: "If that address belongs to an account, a reset link has been sent." };
export async function POST(request: NextRequest) {
  if (!isAuthEnabled()) return authenticationDisabledResponse();
  const limited = consumeRateLimit(rateLimitKey(request, "forgot-password"), 5, 15 * 60_000);
  if (!limited.allowed) return NextResponse.json({ message: "Too many reset requests. Try again later." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(generic);
  if (!canDeliverEmail() || !process.env.AUTH_BASE_URL) return NextResponse.json({ message: "Password reset is temporarily unavailable." }, { status: 503 });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, email: true, emailVerifiedAt: true } });
  if (!user?.emailVerifiedAt) return NextResponse.json(generic);
  const token = await issuePasswordResetToken(user.id);
  await deliverEmail({ to: user.email, subject: "Reset your Luzon Tollmap password", text: `Use this link within one hour to reset your password: ${appUrl(`/reset-password?token=${encodeURIComponent(token)}`)}` }).catch(() => undefined);
  return NextResponse.json(generic);
}
