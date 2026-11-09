export type Coordinate = [number, number];
export type RouteGeometry = { type: "LineString"; coordinates: Coordinate[] };
export type NormalizedRouteStep = { name: string; ref?: string; start: Coordinate; end: Coordinate; distanceMeters: number; durationSeconds: number };
export type RouteCandidate = { id: string; distanceMeters: number; durationSeconds: number; geometry: RouteGeometry; steps: NormalizedRouteStep[]; provider: "mapbox" | "google" };

export type RoutingProvider = {
  name: RouteCandidate["provider"];
  isConfigured(): boolean;
  geocode(place: string): Promise<Coordinate | undefined>;
  getDrivingRoutes(origin: Coordinate, destination: Coordinate, avoidTolls?: boolean): Promise<RouteCandidate[]>;
};
