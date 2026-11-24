import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runTollMonitor } from "@/lib/toll-data/monitor";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret === "generate-a-long-random-secret") return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Scheduled toll-rate monitoring. Vercel Cron invokes GET; POST is retained for secured manual runs. */
async function run(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ message: "A valid CRON_SECRET bearer token is required." }, { status: 401 });
  const trigger = request.nextUrl.searchParams.get("trigger") === "weekly" ? "weekly" : "daily";
  try {
    const result = await runTollMonitor(prisma, { trigger });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[toll-monitor]", error);
    return NextResponse.json({ message: "The toll monitor failed. Approved rates were not changed." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }
