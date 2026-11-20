import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, deleteSession, sessionCookieName } from "@/lib/auth/session";
import { isAuthEnabled } from "@/lib/auth/config";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(sessionCookieName)?.value;
  if (token) await deleteSession(token);
  const response = NextResponse.json({ message: isAuthEnabled() ? "Signed out." : "Authentication is temporarily disabled." }, { status: isAuthEnabled() ? 200 : 503 });
  clearSessionCookie(response);
  return response;
}
