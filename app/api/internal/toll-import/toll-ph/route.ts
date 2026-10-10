import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stageTollPhImport } from "@/lib/toll-import/import-service.js";

export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret === "generate-a-long-random-secret") return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: "A valid CRON_SECRET bearer token is required." }, { status: 401 });
  }

  try {
    const result = await stageTollPhImport(prisma);
    return NextResponse.json({ ...result, message: result.unchanged ? "The current Toll.ph snapshot is already staged." : "Toll.ph matrix staged for manual review." });
  } catch {
    return NextResponse.json({ message: "Toll.ph could not be imported. No customer-facing rate was changed." }, { status: 502 });
  }
}
