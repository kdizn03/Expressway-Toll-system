import { isInPhilippines } from "../geo/philippines";
import { isInLuzonCoverage, LUZON_SEARCH_BOUNDS } from "../geo/luzon";
import { GoogleMapsError, googleErrorFromResponse, type GoogleService } from "./errors";
import { normalizeGoogleRoutes, type GoogleRoutesResponse } from "./google-route-adapter";
import { preciseAlias } from "./place-aliases";
import { TtlCache } from "./ttl-cache";
import type { Coordinate, ResolvedPlace, RouteCandidate } from "./types";

/** Server-only key (Routes API + Places API (New) Text Search). Never prefix it with NEXT_PUBLIC_. */
const serverKey = () => process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim();
export const isGoogleConfigured = () => Boolean(serverKey());

/** Rectangle around the Luzon coverage polygon, used only to bias free-text searches (validation uses the polygon). */
const LUZON_BIAS = { rectangle: { low: { latitude: LUZON_SEARCH_BOUNDS.south, longitude: LUZON_SEARCH_BOUNDS.west }, high: { latitude: LUZON_SEARCH_BOUNDS.north, longitude: LUZON_SEARCH_BOUNDS.east } } };
const ROUTE_FIELD_MASK = [
  "routes.description", "routes.duration", "routes.distanceMeters", "routes.polyline.encodedPolyline",
  "routes.legs.steps.distanceMeters", "routes.legs.steps.staticDuration", "routes.legs.steps.navigationInstruction",
  "routes.legs.steps.startLocation", "routes.legs.steps.endLocation",
].join(",");

// Traffic-aware routes go stale quickly, so cache only briefly; this mainly absorbs
// repeated clicks and identical searches. Place lookups are cached a little longer.
const routeCache = new TtlCache<Promise<RouteCandidate[]>>(5 * 60_000);
const placeCache = new TtlCache<Promise<ResolvedPlace | undefined>>(60 * 60_000);

function requireKey() {
  const key = serverKey();
  if (!key) throw new GoogleMapsError("NOT_CONFIGURED", "Google Maps is not configured on the server. Set GOOGLE_MAPS_SERVER_API_KEY and restart the application.", 503);
  return key;
}

async function googlePost<T>(service: GoogleService, url: string, fieldMask: string, payload: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": requireKey(), "X-Goog-FieldMask": fieldMask },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof GoogleMapsError) throw error;
    throw new GoogleMapsError("NETWORK", "Could not reach Google Maps. Check the server's internet connection and try again.", 502, String(error));
  }
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw googleErrorFromResponse(service, response.status, body);
  return body as T;
}

export type TextSearchResponse = { places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number }; addressComponents?: Array<{ shortText?: string; types?: string[] }> }> };

/**
 * Accepts Google's best match only when it is in the Philippines: the address must name the
 * Philippines (country "PH") and the coordinates must pass the boundary check. An overseas
 * best match (e.g. "New Jersey" → New Jersey, USA) is rejected rather than replaced by a
 * weaker Philippine result, so the user is asked to pick a Philippine place instead.
 */
export function philippinePlaceFromTextSearch(body: TextSearchResponse, text: string): ResolvedPlace | undefined {
  const place = body.places?.[0]; const location = place?.location;
  if (!place || !Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) return undefined;
  const country = place.addressComponents?.find((component) => component.types?.includes("country"))?.shortText?.toUpperCase();
  const coordinate: Coordinate = [location!.longitude!, location!.latitude!];
  if (country !== "PH" || !isInPhilippines(coordinate)) return undefined;
  return { placeId: place.id, name: place.displayName?.text ?? text, address: place.formattedAddress, coordinate };
}

/**
 * Like philippinePlaceFromTextSearch, but the best match must also fall inside the supported
 * Luzon coverage polygon. "Cebu City" or "Davao City" are Philippine but outside coverage, so
 * they are rejected instead of being replaced by a similarly named place in Luzon.
 */
export function luzonPlaceFromTextSearch(body: TextSearchResponse, text: string): ResolvedPlace | undefined {
  const place = philippinePlaceFromTextSearch(body, text);
  return place && isInLuzonCoverage(place.coordinate) ? place : undefined;
}

/**
 * Resolves a typed place (one not picked from autocomplete) with Places API (New) Text Search,
 * biased toward Luzon and accepted only when the best match is inside Luzon coverage.
 */
export function resolvePlace(text: string): Promise<ResolvedPlace | undefined> {
  const alias = preciseAlias(text);
  if (alias) return Promise.resolve({ name: text.trim(), coordinate: alias });
  const cacheKey = text.trim().toLocaleLowerCase("en-PH");
  const cached = placeCache.get(cacheKey); if (cached) return cached;
  const request = googlePost<TextSearchResponse>("places", "https://places.googleapis.com/v1/places:searchText", "places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents", {
    textQuery: text, regionCode: "PH", languageCode: "en", locationBias: LUZON_BIAS, pageSize: 1,
  }).then((body) => luzonPlaceFromTextSearch(body, text));
  placeCache.set(cacheKey, request);
  request.catch(() => placeCache.delete(cacheKey)); // never cache failures
  return request;
}

/** Driving routes from the Routes API, normalized for the toll matcher. Alternatives are requested for normal routing. */
export function getDrivingRoutes(origin: Coordinate, destination: Coordinate, avoidTolls = false): Promise<RouteCandidate[]> {
  const cacheKey = [...origin, ...destination].map((value) => value.toFixed(5)).join(",") + (avoidTolls ? ":avoid" : "");
  const cached = routeCache.get(cacheKey); if (cached) return cached;
  const request = googlePost<GoogleRoutesResponse>("routes", "https://routes.googleapis.com/directions/v2:computeRoutes", ROUTE_FIELD_MASK, {
    origin: { location: { latLng: { latitude: origin[1], longitude: origin[0] } } },
    destination: { location: { latLng: { latitude: destination[1], longitude: destination[0] } } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    computeAlternativeRoutes: !avoidTolls,
    // avoidTolls is a preference, not a guarantee; the toll engine still inspects the result.
    routeModifiers: { avoidTolls },
    languageCode: "en-US",
    regionCode: "PH",
    units: "METRIC",
  }).then((body) => normalizeGoogleRoutes(body, avoidTolls));
  routeCache.set(cacheKey, request);
  request.catch(() => routeCache.delete(cacheKey)); // never cache failures
  return request;
}
