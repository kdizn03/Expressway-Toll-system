import { NextResponse } from "next/server";

/**
 * Temporary authentication feature flag. Authentication is deliberately opt-in
 * while the application is under development; only the exact string "true"
 * enables account flows.
 */
export function isAuthEnabled(value = process.env.AUTH_ENABLED) {
  return value === "true";
}

export function authenticationDisabledResponse() {
  return NextResponse.json({ message: "Authentication is temporarily disabled." }, { status: 503 });
}
