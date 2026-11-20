import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isAuthEnabled } from "@/lib/auth/config";

export async function GET() {
  if (!isAuthEnabled()) return NextResponse.json({ authEnabled: false, user: null });
  const user = await getCurrentUser();
  return NextResponse.json({ authEnabled: true, user: user ? { id: user.id, fullName: user.fullName, email: user.email, role: user.role } : null });
}
