import { NextResponse } from "next/server";
import { createGoogleState, googleConfigured, googleRedirectUri, googleStateCookieName, googleStateCookieOptions } from "@/lib/auth/google";

export async function GET() {
  if (!googleConfigured()) return NextResponse.json({ message: "Google sign-in is not configured." }, { status: 503 });
  const state = createGoogleState();
  const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: googleRedirectUri(), response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  response.cookies.set(googleStateCookieName(), state, googleStateCookieOptions());
  return response;
}
