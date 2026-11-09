import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, deleteSession, sessionCookieName } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(sessionCookieName)?.value;
  if (token) await deleteSession(token);
  const response = NextResponse.json({ message: "Signed out." });
  clearSessionCookie(response);
  return response;
}
