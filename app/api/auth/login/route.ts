import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { rateLimitKey, requestMetadata } from "@/lib/auth/request";
import { prisma } from "@/lib/db";
import { loginSchema } from "@/lib/validation";
import { authenticationDisabledResponse, isAuthEnabled } from "@/lib/auth/config";

export async function POST(request: NextRequest) {
  if (!isAuthEnabled()) return authenticationDisabledResponse();
  const limited = consumeRateLimit(rateLimitKey(request, "login"), 10, 15 * 60_000);
  if (!limited.allowed) return NextResponse.json({ message: "Too many sign-in attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Enter your email and password." }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, passwordHash: true, emailVerifiedAt: true, fullName: true, email: true, role: true } });
  if (!user?.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) return NextResponse.json({ message: "Invalid email or password." }, { status: 401 });
  if (!user.emailVerifiedAt) return NextResponse.json({ message: "Verify your email before signing in." }, { status: 403 });
  const session = await createSession(user.id, requestMetadata(request));
  const response = NextResponse.json({ user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role } });
  setSessionCookie(response, session.token, session.expiresAt);
  return response;
}
