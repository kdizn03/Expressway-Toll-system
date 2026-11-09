import { NextResponse } from "next/server";
import { routeSearchSchema } from "@/lib/validation";
import { routingProvider } from "@/lib/routing/provider";
import { matchRouteToTolls } from "@/lib/toll/route-matcher";
import { tollCalculationService } from "@/lib/toll";
import { rankRouteAlternatives } from "@/lib/routing/route-ranking";

export async function POST(request: Request) {
  try {
    const parsed = routeSearchSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ message: "Enter a valid origin, destination, and vehicle class." }, { status: 400 });
    const provider = routingProvider();
    if (!provider.isConfigured()) return NextResponse.json({ message: "The routing provider is not configured. Check the server environment variables and restart the application." }, { status: 503 });
    const input = parsed.data;
    const [origin, destination] = await Promise.all([provider.geocode(input.origin), provider.geocode(input.destination)]);
    if (!origin || !destination) return NextResponse.json({ message: "We could not locate one of those places." }, { status: 422 });
    const travelDate = input.departureAt ?? new Date();
    const [driving, avoiding] = await Promise.all([provider.getDrivingRoutes(origin, destination), provider.getDrivingRoutes(origin, destination, true)]);
    const calculateCandidate = async (route: (typeof driving)[number], avoidTolls = false) => {
      const roads = await matchRouteToTolls(route);
      const toll = await tollCalculationService.calculate(roads, input.vehicleClass, travelDate, input.roundTrip);
      const tollsAvoided = avoidTolls && roads.length === 0;
      const noMatch = roads.length === 0 && !tollsAvoided;
      return { id: route.id, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, expressways: roads.map((road) => road.expressway), toll: { ...toll, status: tollsAvoided ? "ESTIMATED" : noMatch ? "UNAVAILABLE" : toll.status, totalCentavos: tollsAvoided ? 0 : noMatch ? undefined : toll.totalCentavos, tollsAvoided, disclaimer: tollsAvoided ? "No supported toll-road segment was detected on this toll-avoidance route." : toll.disclaimer }, geometry: route.geometry };
    };
    const normalRoutes = await Promise.all(driving.map((route) => calculateCandidate(route)));
    const ranked = rankRouteAlternatives(normalRoutes);
    const normalResults = ranked.ordered.map((route) => {
      const preferences = ranked.labels.get(route.id) ?? ["BALANCED"];
      return { ...route, mode: preferences[0], preferences };
    });
    const avoidResults = await Promise.all(avoiding.slice(0, 1).map(async (route) => ({ ...(await calculateCandidate(route, true)), mode: "AVOID_TOLLS" as const, preferences: ["AVOID_TOLLS"] as const })));
    return NextResponse.json({ origin: input.origin, destination: input.destination, vehicleClass: input.vehicleClass, results: [...normalResults, ...avoidResults], unavailablePreferences: ranked.unavailable });
  } catch {
    return NextResponse.json({ message: "Route calculation is temporarily unavailable. Please try again shortly." }, { status: 502 });
  }
}
