import { NextRequest, NextResponse } from "next/server";
import { canDeliverEmail, deliverEmail, appUrl } from "@/lib/auth/email";
import { issueEmailVerificationToken } from "@/lib/auth/account-service";
import { hashPassword } from "@/lib/auth/password";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { rateLimitKey } from "@/lib/auth/request";
import { prisma } from "@/lib/db";
import { registerSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const limited = consumeRateLimit(rateLimitKey(request, "register"), 5, 15 * 60_000);
  if (!limited.allowed) return NextResponse.json({ message: "Too many registration attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Enter valid registration details." }, { status: 400 });
  if (!canDeliverEmail() || !process.env.AUTH_BASE_URL) return NextResponse.json({ message: "Registration is temporarily unavailable while email delivery is configured." }, { status: 503 });
  const { fullName, email, password } = parsed.data;
  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) return NextResponse.json({ message: "An account with this email already exists." }, { status: 409 });
    const user = await prisma.user.create({ data: { fullName, email, passwordHash: await hashPassword(password) } });
    const token = await issueEmailVerificationToken(user.id);
    try {
      await deliverEmail({ to: user.email, subject: "Verify your Luzon Tollmap email", text: `Welcome to Luzon Tollmap. Verify your email within 24 hours: ${appUrl(`/api/auth/verify?token=${encodeURIComponent(token)}`)}` });
    } catch {
      await prisma.user.delete({ where: { id: user.id } });
      return NextResponse.json({ message: "Registration is temporarily unavailable. Please try again." }, { status: 503 });
    }
    return NextResponse.json({ message: "Check your email for a verification link before signing in." }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "Registration is temporarily unavailable. Please try again." }, { status: 503 });
  }
}
