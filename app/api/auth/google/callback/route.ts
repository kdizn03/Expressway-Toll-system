import { NextRequest, NextResponse } from "next/server";
import { googleConfigured, googleRedirectUri, googleStateCookieName, googleStateCookieOptions } from "@/lib/auth/google";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requestMetadata } from "@/lib/auth/request";
import { isAuthEnabled } from "@/lib/auth/config";

type GoogleProfile = { sub?: string; email?: string; email_verified?: boolean; name?: string };
const failure = (request: NextRequest) => NextResponse.redirect(new URL("/login?google=failed", request.url));

export async function GET(request: NextRequest) {
  if (!isAuthEnabled()) return NextResponse.redirect(new URL("/", request.url));
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const expectedState = request.cookies.get(googleStateCookieName())?.value;
  if (!googleConfigured() || !code || !state || state !== expectedState) return failure(request);
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: googleRedirectUri(), grant_type: "authorization_code" }) });
    const tokenData = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!tokenResponse.ok || !tokenData.access_token) return failure(request);
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const profile = await profileResponse.json() as GoogleProfile;
    if (!profileResponse.ok || !profile.sub || !profile.email || !profile.email_verified) return failure(request);
    const email = profile.email.toLocaleLowerCase("en-US");
    const existingAccount = await prisma.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider: "google", providerAccountId: profile.sub } }, select: { userId: true } });
    let userId = existingAccount?.userId;
    if (!userId) {
      const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      const user = existingUser ?? await prisma.user.create({ data: { fullName: profile.name?.slice(0, 100) || "Google user", email, emailVerifiedAt: new Date() } });
      userId = user.id;
      await prisma.oAuthAccount.create({ data: { userId, provider: "google", providerAccountId: profile.sub, refreshToken: tokenData.refresh_token, expiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null } });
    }
    const session = await createSession(userId, requestMetadata(request));
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(googleStateCookieName(), "", { ...googleStateCookieOptions(), maxAge: 0 });
    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch { return failure(request); }
}
