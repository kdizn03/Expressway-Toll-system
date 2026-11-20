import { NextResponse } from "next/server";
import { googleConfigured } from "@/lib/auth/google";
import { isAuthEnabled } from "@/lib/auth/config";
export async function GET() { return NextResponse.json({ google: isAuthEnabled() && googleConfigured(), authEnabled: isAuthEnabled() }); }
