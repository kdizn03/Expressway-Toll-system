import * as google from "./google";
import * as mapbox from "./mapbox";
import type { RoutingProvider } from "./types";

const mapboxProvider: RoutingProvider = { name: "mapbox", isConfigured: mapbox.isMapboxConfigured, geocode: mapbox.geocode, getDrivingRoutes: mapbox.getDrivingRoutes };
const googleProvider: RoutingProvider = { name: "google", isConfigured: google.isGoogleConfigured, geocode: google.geocode, getDrivingRoutes: google.getDrivingRoutes };

/** Google becomes active only when explicitly selected and fully configured. */
export function routingProvider(): RoutingProvider {
  if (process.env.ROUTING_PROVIDER?.toLowerCase() === "google" && googleProvider.isConfigured()) return googleProvider;
  return mapboxProvider;
}
