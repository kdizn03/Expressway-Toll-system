import { NextResponse } from "next/server";
import { googleConfigured } from "@/lib/auth/google";
export async function GET() { return NextResponse.json({ google: googleConfigured() }); }
