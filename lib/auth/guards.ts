import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";

export async function requireApiUser() {
  const user = await getCurrentUser();
  return user ?? null;
}

export function unauthorized() { return NextResponse.json({ message: "Sign in to access this resource." }, { status: 401 }); }
export function forbidden() { return NextResponse.json({ message: "You are not authorized to perform this action." }, { status: 403 }); }
