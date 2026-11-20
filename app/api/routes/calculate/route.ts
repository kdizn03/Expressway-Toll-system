import { NextResponse } from "next/server";
import { routeSearchSchema } from "@/lib/validation";
import { getDrivingRoutes, isGoogleConfigured, resolvePlace } from "@/lib/routing/google";
import { GoogleMapsError } from "@/lib/routing/errors";
import type { ResolvedPlace } from "@/lib/routing/types";
import { expresswayCoverage, keepLuzonRoutes, LUZON_ROUTE_ERROR, NO_EXPRESSWAY_NOTICE, NO_ROAD_ROUTE_ERROR, resolveTripLocation } from "@/lib/routing/trip-validation";
import { matchRouteToTolls } from "@/lib/toll/route-matcher";
import { tollCalculationService } from "@/lib/toll";
import { rankRouteAlternatives } from "@/lib/routing/route-ranking";

const placeView = (place: ResolvedPlace) => ({ placeId: place.placeId, name: place.name, address: place.address, latitude: place.coordinate[1], longitude: place.coordinate[0] });

export async function POST(request: Request) {
  try {
    const parsed = routeSearchSchema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return NextResponse.json({ message: "Enter a valid origin, destination, and vehicle class." }, { status: 400 });
    if (!isGoogleConfigured()) return NextResponse.json({ message: "Google Maps is not configured on the server. Set GOOGLE_MAPS_SERVER_API_KEY and restart the application." }, { status: 503 });
    const input = parsed.data;
    // Both ends are validated against the Luzon coverage boundary before any Routes API request.
    const [originResult, destinationResult] = await Promise.all([resolveTripLocation(input.origin, input.originPlace, resolvePlace), resolveTripLocation(input.destination, input.destinationPlace, resolvePlace)]);
    if (!originResult.ok) return NextResponse.json({ message: originResult.message, field: "origin" }, { status: 422 });
    if (!destinationResult.ok) return NextResponse.json({ message: destinationResult.message, field: "destination" }, { status: 422 });
    const origin = originResult.place; const destination = destinationResult.place;
    if (origin.coordinate[0] === destination.coordinate[0] && origin.coordinate[1] === destination.coordinate[1]) return NextResponse.json({ message: "Origin and destination resolve to the same place. Choose two different locations." }, { status: 400 });
    const travelDate = input.departureAt ?? new Date();
    const [allDriving, allAvoiding] = await Promise.all([getDrivingRoutes(origin.coordinate, destination.coordinate), getDrivingRoutes(origin.coordinate, destination.coordinate, true)]);
    if (allDriving.length === 0 && allAvoiding.length === 0) return NextResponse.json({ message: NO_ROAD_ROUTE_ERROR }, { status: 422 });
    // Routes that leave Luzon coverage (e.g. ferries to other islands) are dropped before any toll is calculated for them.
    const driving = keepLuzonRoutes(allDriving); const avoiding = keepLuzonRoutes(allAvoiding);
    if (driving.length === 0 && avoiding.length === 0) return NextResponse.json({ message: LUZON_ROUTE_ERROR }, { status: 422 });
    // Google supplies geometry, distance and time; the toll engine and rate database remain the source of truth for tolls.
    const calculateCandidate = async (route: (typeof driving)[number], avoidTolls = false) => {
      const roads = await matchRouteToTolls(route);
      const toll = await tollCalculationService.calculate(roads, input.vehicleClass, travelDate, input.roundTrip);
      // ₱0 is shown only when no supported expressway matched AND Google reports no toll road on the route.
      // A toll road the app cannot price stays "unavailable" rather than being shown as free.
      const coverage = expresswayCoverage(route, roads.length);
      const free = coverage === "NO_TOLL_ROAD";
      const tollsAvoided = avoidTolls && free;
      const noExpressway = !avoidTolls && free;
      const unsupported = coverage === "UNSUPPORTED_TOLL_ROAD";
      const disclaimer = tollsAvoided ? "No supported toll-road segment was detected on this toll-avoidance route."
        : noExpressway ? "This route uses ordinary roads only; no expressway toll applies."
        : unsupported ? "This route uses a toll road that is not part of the supported expressway network, so its toll cannot be estimated."
        : toll.disclaimer;
      return { id: route.id, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, expressways: roads.map((road) => road.expressway), coverage, toll: { ...toll, status: free ? "ESTIMATED" : unsupported ? "UNAVAILABLE" : toll.status, totalCentavos: free ? 0 : unsupported ? undefined : toll.totalCentavos, tollsAvoided, noExpressway, disclaimer }, geometry: route.geometry };
    };
    const normalRoutes = await Promise.all(driving.map((route) => calculateCandidate(route)));
    const ranked = rankRouteAlternatives(normalRoutes);
    const normalResults = ranked.ordered.map((route) => {
      const preferences = ranked.labels.get(route.id) ?? ["BALANCED"];
      return { ...route, mode: preferences[0], preferences };
    });
    const avoidResults = await Promise.all(avoiding.slice(0, 1).map(async (route) => ({ ...(await calculateCandidate(route, true)), mode: "AVOID_TOLLS" as const, preferences: ["AVOID_TOLLS"] as const })));
    const results = [...normalResults, ...avoidResults];
    // Ordinary-road trips are allowed, but say clearly when no supported expressway toll route exists.
    const usesSupportedExpressway = results.some((route) => route.coverage === "SUPPORTED_EXPRESSWAY");
    return NextResponse.json({ origin: input.origin, destination: input.destination, vehicleClass: input.vehicleClass, places: { origin: placeView(origin), destination: placeView(destination) }, results, unavailablePreferences: ranked.unavailable, usesSupportedExpressway, notice: usesSupportedExpressway ? undefined : NO_EXPRESSWAY_NOTICE });
  } catch (error) {
    if (error instanceof GoogleMapsError) {
      console.error("[routes/calculate]", error.message);
      return NextResponse.json({ message: error.userMessage, code: error.code }, { status: error.httpStatus });
    }
    console.error("[routes/calculate]", error);
    return NextResponse.json({ message: "Route calculation is temporarily unavailable. Please try again shortly." }, { status: 502 });
  }
}
