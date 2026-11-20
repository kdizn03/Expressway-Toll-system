export type Coordinate = [number, number];
export type RouteGeometry = { type: "LineString"; coordinates: Coordinate[] };
/**
 * Provider-neutral step consumed by the toll matcher. `name`/`ref` carry the road
 * label used for expressway identification; `instruction` keeps the provider's raw text.
 */
export type NormalizedRouteStep = { name: string; ref?: string; start: Coordinate; end: Coordinate; distanceMeters: number; durationSeconds: number; instruction?: string; tolled?: boolean };
export type RouteCandidate = { id: string; distanceMeters: number; durationSeconds: number; geometry: RouteGeometry; steps: NormalizedRouteStep[]; provider: "google"; encodedPolyline?: string; summary?: string };

/** A place the route is calculated from or to, resolved from a Places selection or a text search. */
export type ResolvedPlace = { placeId?: string; name: string; address?: string; coordinate: Coordinate };
