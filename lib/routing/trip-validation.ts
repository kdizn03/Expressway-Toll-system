import { isInLuzonCoverage, routeStaysInLuzon } from "../geo/luzon";
import type { ResolvedPlace, RouteCandidate } from "./types";

import { LUZON_LOCATION_ERROR } from "./messages";
export { LUZON_LOCATION_ERROR, LUZON_ROUTE_ERROR, NO_EXPRESSWAY_NOTICE, NO_ROAD_ROUTE_ERROR } from "./messages";

export type SelectedPlaceInput = { placeId: string; name?: string; address?: string; latitude: number; longitude: number };
export type LocationResult = { ok: true; place: ResolvedPlace } | { ok: false; message: string };

/**
 * Resolves one trip end on the server. An autocomplete selection is trusted only after its
 * coordinates pass the Luzon coverage check (the browser can send anything); typed text goes
 * through `resolveText`, which itself only returns places inside coverage.
 */
export async function resolveTripLocation(text: string, selected: SelectedPlaceInput | undefined, resolveText: (text: string) => Promise<ResolvedPlace | undefined>): Promise<LocationResult> {
  const place: ResolvedPlace | undefined = selected
    ? { placeId: selected.placeId, name: selected.name ?? text, address: selected.address, coordinate: [selected.longitude, selected.latitude] }
    : await resolveText(text);
  if (!place || !isInLuzonCoverage(place.coordinate)) return { ok: false, message: LUZON_LOCATION_ERROR };
  return { ok: true, place };
}

/** Drops any route whose geometry leaves Luzon coverage (ferries to other islands, other regions), so it is never priced or shown. */
export function keepLuzonRoutes(routes: RouteCandidate[]): RouteCandidate[] {
  return routes.filter((route) => routeStaysInLuzon(route.geometry));
}

/**
 * How a route relates to the supported expressway network:
 * - SUPPORTED_EXPRESSWAY: the toll matcher identified at least one supported expressway.
 * - NO_TOLL_ROAD: no supported expressway and the provider reports no toll road anywhere on it,
 *   so no expressway toll applies (ordinary roads only).
 * - UNSUPPORTED_TOLL_ROAD: the provider reports a toll road the app cannot price; never shown as ₱0.
 */
export type ExpresswayCoverage = "SUPPORTED_EXPRESSWAY" | "NO_TOLL_ROAD" | "UNSUPPORTED_TOLL_ROAD";
export function expresswayCoverage(route: Pick<RouteCandidate, "steps">, matchedExpressways: number): ExpresswayCoverage {
  if (matchedExpressways > 0) return "SUPPORTED_EXPRESSWAY";
  return route.steps.some((step) => step.tolled !== false) ? "UNSUPPORTED_TOLL_ROAD" : "NO_TOLL_ROAD";
}
