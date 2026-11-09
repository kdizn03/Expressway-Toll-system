import { NextRequest, NextResponse } from "next/server";
import { consumeEmailVerificationToken } from "@/lib/auth/account-service";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const verified = token ? await consumeEmailVerificationToken(token) : false;
  const url = new URL(verified ? "/login?verified=1" : "/login?verification=invalid", request.url);
  return NextResponse.redirect(url);
}
