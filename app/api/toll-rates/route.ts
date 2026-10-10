import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { databaseRateLookup } from "@/lib/toll/rate-repository";

const querySchema = z.object({
  expressway: z.string().min(2), origin: z.string().min(1), destination: z.string().min(1),
  vehicleClass: z.enum(["CLASS_1", "CLASS_2", "CLASS_3"]), travelDate: z.coerce.date().optional(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ message: "expressway, origin, destination, and vehicleClass are required." }, { status: 400 });
  const input = parsed.data;
  const travelDate = input.travelDate ?? new Date();
  const rate = await databaseRateLookup({ expressway: input.expressway, entry: input.origin, exit: input.destination, confidence: "HIGH" }, input.vehicleClass, travelDate);
  if (!rate || rate.centavos === undefined) return NextResponse.json({ status: rate?.unavailableReason ? "RATE_DATABASE_UNAVAILABLE" : "RATE_UNAVAILABLE", message: rate?.unavailableReason ?? "No published rate applies to this plaza pair and travel date." }, { status: rate?.unavailableReason ? 503 : 404 });
  return NextResponse.json({ expressway: input.expressway, origin: input.origin, destination: input.destination, vehicleClass: input.vehicleClass, toll: rate.centavos / 100, effectiveFrom: rate.effectiveFrom, source: rate.source, sourceUrl: rate.sourceUrl, lastVerified: rate.lastVerifiedAt, rateVersion: rate.version });
}
