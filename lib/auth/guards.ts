import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isAuthEnabled } from "@/lib/auth/config";

export async function requireApiUser() {
  const user = await getCurrentUser();
  return user ?? null;
}

export function unauthorized() { return isAuthEnabled() ? NextResponse.json({ message: "Sign in to access this resource." }, { status: 401 }) : NextResponse.json({ message: "Authentication is temporarily disabled." }, { status: 503 }); }
export function forbidden() { return NextResponse.json({ message: "You are not authorized to perform this action." }, { status: 403 }); }
