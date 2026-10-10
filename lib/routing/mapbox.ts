export type Coordinate = [number, number];
/** Minimal GeoJSON shape returned by Mapbox; keeping it local avoids an ambient GeoJSON namespace dependency. */
export type RouteGeometry = { type: "LineString"; coordinates: Coordinate[] };
export type NormalizedRouteStep = { name: string; ref?: string; start: Coordinate; end: Coordinate; distanceMeters: number; durationSeconds: number };
export type RouteCandidate = { id: string; distanceMeters: number; durationSeconds: number; geometry: RouteGeometry; steps: NormalizedRouteStep[]; provider: "mapbox" };

type MapboxRoute = { distance: number; duration: number; geometry: RouteGeometry; legs?: Array<{ steps?: Array<{ name?: string; ref?: string; distance: number; duration: number; maneuver: { location: Coordinate }; intersections?: Array<{ location: Coordinate }> }> }> };
const accessToken = () => {
  const serverToken = process.env.MAPBOX_ACCESS_TOKEN?.trim();
  // Ignore the documented example value so a real public browser token can be used in local development.
  return serverToken && serverToken !== "pk_or_sk_server_token" ? serverToken : process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
};
export const isMapboxConfigured = () => Boolean(accessToken());

export async function geocode(place: string): Promise<Coordinate | undefined> {
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
