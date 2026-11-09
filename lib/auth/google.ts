import { createOpaqueToken } from "@/lib/auth/tokens";

const stateCookieName = "luzon_tollmap_google_state";
const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 10 * 60 };

export function googleConfigured() { return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_BASE_URL); }
export function googleStateCookieName() { return stateCookieName; }
export function createGoogleState() { return createOpaqueToken(); }
export function googleStateCookieOptions() { return cookieOptions; }
export function googleRedirectUri() { return `${process.env.AUTH_BASE_URL?.replace(/\/$/, "")}/api/auth/google/callback`; }
