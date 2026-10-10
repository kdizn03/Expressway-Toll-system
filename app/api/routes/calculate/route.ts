import { NextResponse } from "next/server";
import { routeSearchSchema } from "@/lib/validation";
import { geocode, getDrivingRoutes, isMapboxConfigured } from "@/lib/routing/mapbox";
import { matchRouteToTolls } from "@/lib/toll/route-matcher";
import { tollCalculationService } from "@/lib/toll";

const category = (index: number, avoidTolls: boolean) => avoidTolls ? "AVOID_TOLLS" : index === 0 ? "FASTEST" : "BALANCED";

export async function POST(request: Request) {
  const parsed = routeSearchSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "Enter a valid origin, destination, and vehicle class." }, { status: 400 });
  if (!isMapboxConfigured()) return NextResponse.json({ message: "Mapbox is not configured. Add NEXT_PUBLIC_MAPBOX_TOKEN and restart the development server." }, { status: 503 });
  try {
    const input = parsed.data;
    const [origin, destination] = await Promise.all([geocode(input.origin), geocode(input.destination)]);
    if (!origin || !destination) return NextResponse.json({ message: "We could not locate one of those places." }, { status: 422 });
    const travelDate = input.departureAt ?? new Date();
    const [driving, avoiding] = await Promise.all([getDrivingRoutes(origin, destination), getDrivingRoutes(origin, destination, true)]);
    const candidates = [...driving.map((route, index) => ({ route, mode: category(index, false) })), ...avoiding.slice(0, 1).map((route) => ({ route, mode: category(0, true) }))];
    const results = await Promise.all(candidates.map(async ({ route, mode }) => {
      const roads = await matchRouteToTolls(route);
      const toll = await tollCalculationService.calculate(roads, input.vehicleClass, travelDate, input.roundTrip);
      const tollsAvoided = mode === "AVOID_TOLLS" && roads.length === 0;
      const noMatch = roads.length === 0 && !tollsAvoided;
      return { id: route.id, mode, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, expressways: roads.map((road) => road.expressway), toll: { ...toll, status: tollsAvoided ? "NOT_APPLICABLE" : noMatch ? "UNAVAILABLE" : toll.status, totalCentavos: tollsAvoided ? 0 : noMatch ? undefined : toll.totalCentavos, tollsAvoided }, geometry: route.geometry };
    }));
    return NextResponse.json({ origin: input.origin, destination: input.destination, vehicleClass: input.vehicleClass, results });
  } catch {
    return NextResponse.json({ message: "Route calculation is temporarily unavailable. Please try again shortly." }, { status: 502 });
  }
}
