import { NextRequest, NextResponse } from "next/server";
import { consumeEmailVerificationToken } from "@/lib/auth/account-service";
import { isAuthEnabled } from "@/lib/auth/config";

export async function GET(request: NextRequest) {
  if (!isAuthEnabled()) return NextResponse.redirect(new URL("/", request.url));
  const token = request.nextUrl.searchParams.get("token");
  const verified = token ? await consumeEmailVerificationToken(token) : false;
  const url = new URL(verified ? "/login?verified=1" : "/login?verification=invalid", request.url);
  return NextResponse.redirect(url);
}
