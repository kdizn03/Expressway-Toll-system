import type { Coordinate, RouteCandidate, RouteGeometry } from "./types";
export type { Coordinate, RouteCandidate, RouteGeometry } from "./types";

type MapboxRoute = { distance: number; duration: number; geometry: RouteGeometry; legs?: Array<{ steps?: Array<{ name?: string; ref?: string; distance: number; duration: number; maneuver: { location: Coordinate }; intersections?: Array<{ location: Coordinate }> }> }> };
const accessToken = () => {
  const serverToken = process.env.MAPBOX_ACCESS_TOKEN?.trim();
  // Ignore the documented example value so a real public browser token can be used in local development.
  return serverToken && serverToken !== "pk_or_sk_server_token" ? serverToken : process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
};
export const isMapboxConfigured = () => Boolean(accessToken());

// Mapbox's broad Philippine index can return a same-named locality in a
// different province. Keep a very small, documented set of unambiguous local
// aliases for well-known Metro Manila districts until an address-autocomplete
// selection is supplied by the UI.
const precisePhilippineAliases: Record<string, Coordinate> = {
  "sampaloc, manila": [121.0022, 14.6031],
  "sampaloc, manila, philippines": [121.0022, 14.6031],
  // Kabatas Compound is in Western Bicutan, beside Lawton Avenue—not Taguig's
  // city-label point. This locator is deliberately limited to the compound.
  "kabatas, taguig": [121.036582, 14.533484],
  "kabatas, taguig, metro manila": [121.036582, 14.533484],
  "kabatas compound, taguig": [121.036582, 14.533484],
};
const normalizePlace = (place: string) => place.trim().toLocaleLowerCase("en-PH").replace(/\s+/g, " ");

export async function geocode(place: string): Promise<Coordinate | undefined> {
  const preciseMatch = precisePhilippineAliases[normalizePlace(place)];
  if (preciseMatch) return preciseMatch;
  const token = accessToken(); if (!token) throw new Error("Mapbox is not configured. Restart the development server after adding the token.");
  const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(place)}&limit=1&country=PH&access_token=${token}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Mapbox could not search for that location.");
  const body = await response.json() as { features?: Array<{ geometry?: { coordinates?: Coordinate } }> };
  return body.features?.[0]?.geometry?.coordinates;
}

export async function getDrivingRoutes(origin: Coordinate, destination: Coordinate, avoidTolls = false): Promise<RouteCandidate[]> {
  const token = accessToken(); if (!token) throw new Error("Routing is not configured.");
  const exclusions = avoidTolls ? "&exclude=toll" : "";
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${origin.join(",")};${destination.join(",")}?alternatives=true&steps=true&geometries=geojson&overview=full${exclusions}&access_token=${token}`;
  const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw new Error("The routing provider could not calculate this trip.");
  const body = await response.json() as { routes?: MapboxRoute[] };
  return (body.routes ?? []).map((route, index) => ({ id: `${avoidTolls ? "avoid" : "drive"}-${index}`, distanceMeters: route.distance, durationSeconds: route.duration, geometry: route.geometry, provider: "mapbox", steps: (route.legs ?? []).flatMap((leg) => (leg.steps ?? []).map((step) => ({ name: step.name ?? "Unnamed road", ref: step.ref, start: step.maneuver.location, end: step.intersections?.at(-1)?.location ?? step.maneuver.location, distanceMeters: step.distance, durationSeconds: step.duration }))) }));
}
