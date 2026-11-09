import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { createOpaqueToken, hashToken } from "@/lib/auth/tokens";

export const sessionCookieName = "luzon_tollmap_session";
const sessionDays = 30;
const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

export type CurrentUser = { id: string; fullName: string; email: string; role: "USER" | "ADMIN"; emailVerifiedAt: Date | null };

export async function createSession(userId: string, metadata?: { ipAddress?: string; userAgent?: string }) {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + sessionDays * 86_400_000);
  await prisma.authSession.create({ data: { userId, tokenHash: hashToken(token), expiresAt, ipAddress: metadata?.ipAddress?.slice(0, 120), userAgent: metadata?.userAgent?.slice(0, 500) } });
  return { token, expiresAt };
}

export function setSessionCookie(response: { cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void } }, token: string, expiresAt: Date) {
  response.cookies.set(sessionCookieName, token, { ...cookieOptions, expires: expiresAt, maxAge: sessionDays * 86_400 });
}

export function clearSessionCookie(response: { cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void } }) {
  response.cookies.set(sessionCookieName, "", { ...cookieOptions, maxAge: 0 });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return null;
  return getUserForSessionToken(token);
}

export async function getUserForSessionToken(token: string): Promise<CurrentUser | null> {
  const session = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { id: true, fullName: true, email: true, role: true, emailVerifiedAt: true } } } });
  if (!session) return null;
  if (session.expiresAt <= new Date()) { await prisma.authSession.delete({ where: { id: session.id } }).catch(() => undefined); return null; }
  return session.user;
}

export async function deleteSession(token: string) { await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } }); }
