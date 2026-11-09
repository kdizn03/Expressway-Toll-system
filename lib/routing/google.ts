import type { Coordinate, RouteCandidate, RouteGeometry } from "./types";

const serverKey = () => process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim();
export const isGoogleConfigured = () => Boolean(serverKey());

type GoogleStep = {
  distanceMeters?: number;
  staticDuration?: string;
  navigationInstruction?: { instructions?: string };
  startLocation?: { latLng?: { latitude?: number; longitude?: number } };
  endLocation?: { latLng?: { latitude?: number; longitude?: number } };
};
type GoogleRoute = { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string }; legs?: Array<{ steps?: GoogleStep[] }> };

const seconds = (duration?: string) => duration ? Number.parseFloat(duration.replace("s", "")) || 0 : 0;
const coordinate = (location?: GoogleStep["startLocation"]): Coordinate | undefined => {
  const point = location?.latLng;
  return point?.longitude !== undefined && point.latitude !== undefined ? [point.longitude, point.latitude] : undefined;
};

function decodePolyline(value = ""): Coordinate[] {
  const points: Coordinate[] = [];
  let index = 0; let latitude = 0; let longitude = 0;
  while (index < value.length) {
    let result = 0; let shift = 0; let byte: number;
    do { byte = value.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < value.length);
    latitude += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0; shift = 0;
    do { byte = value.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < value.length);
    longitude += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([longitude / 1e5, latitude / 1e5]);
  }
  return points;
}

export async function geocode(place: string): Promise<Coordinate | undefined> {
  const key = serverKey(); if (!key) throw new Error("Google Maps server key is not configured.");
  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(place)}&region=ph&key=${key}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Google Geocoding request failed.");
  const body = await response.json() as { status?: string; error_message?: string; results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }> };
  if (body.status && body.status !== "OK" && body.status !== "ZERO_RESULTS") throw new Error(`Google Geocoding is unavailable: ${body.error_message ?? body.status}`);
  const point = body.results?.[0]?.geometry?.location;
  return point?.lng !== undefined && point.lat !== undefined ? [point.lng, point.lat] : undefined;
}

export async function getDrivingRoutes(origin: Coordinate, destination: Coordinate, avoidTolls = false): Promise<RouteCandidate[]> {
  const key = serverKey(); if (!key) throw new Error("Google Maps server key is not configured.");
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction.instructions,routes.legs.steps.startLocation,routes.legs.steps.endLocation",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin[1], longitude: origin[0] } } },
      destination: { location: { latLng: { latitude: destination[1], longitude: destination[0] } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes: !avoidTolls,
      routeModifiers: { avoidTolls },
      languageCode: "en-US",
      units: "METRIC",
    }),
  });
  if (!response.ok) throw new Error("Google Routes could not calculate this trip.");
  const body = await response.json() as { routes?: GoogleRoute[] };
  return (body.routes ?? []).map((route, index) => {
    const geometry: RouteGeometry = { type: "LineString", coordinates: decodePolyline(route.polyline?.encodedPolyline) };
    const steps = (route.legs ?? []).flatMap((leg) => (leg.steps ?? []).flatMap((step) => {
      const start = coordinate(step.startLocation); const end = coordinate(step.endLocation);
      return start && end ? [{ name: step.navigationInstruction?.instructions ?? "Unnamed road", start, end, distanceMeters: step.distanceMeters ?? 0, durationSeconds: seconds(step.staticDuration) }] : [];
    }));
    return { id: `${avoidTolls ? "google-avoid" : "google-drive"}-${index}`, distanceMeters: route.distanceMeters ?? 0, durationSeconds: seconds(route.duration), geometry, steps, provider: "google" as const };
  });
}
