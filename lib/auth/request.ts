import type { NextRequest } from "next/server";

export function requestMetadata(request: NextRequest) {
  return {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  };
}

export function rateLimitKey(request: NextRequest, action: string) {
  return `${action}:${requestMetadata(request).ipAddress ?? "unknown"}`;
}
