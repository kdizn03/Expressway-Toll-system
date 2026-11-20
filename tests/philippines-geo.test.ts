import { describe, expect, it } from "vitest";
import { distanceToPhilippinesKm, firstPointOutsidePhilippines, isInPhilippines, isOnPhilippineRoute, PH_TERRITORIAL_SEA_KM, routeStaysInPhilippines, type LngLat } from "../lib/geo/philippines";
import { philippinePlaceFromTextSearch, type TextSearchResponse } from "../lib/routing/google";
import { decodePolyline } from "../lib/routing/google-route-adapter";
import type { RouteCandidate } from "../lib/routing/types";
import recorded from "./fixtures/google-recorded.json";

// Text Search responses and route polylines below were RECORDED from the live Google APIs
// (tests/fixtures/google-recorded.json, 2026-11-19). These tests make no network calls.
const search = (query: keyof typeof recorded.places) => recorded.places[query] as TextSearchResponse;
const route = (name: keyof typeof recorded.routes, id = name): RouteCandidate => ({ id, distanceMeters: recorded.routes[name].distanceMeters, durationSeconds: 1, steps: [], provider: "google", geometry: { type: "LineString", coordinates: decodePolyline(recorded.routes[name].encodedPolyline) } });

const philippine: Record<string, LngLat> = {
  "Baguio City": [120.596, 16.4023], "Manila": [120.9842, 14.5995], "Clark, Pampanga": [120.5466, 15.1855],
  "SM Mall of Asia (reclaimed land)": [120.9822, 14.5352], "Subic Bay port": [120.2667, 14.8167], "Batangas Port": [121.0447, 13.7547],
  "Basco, Batanes": [121.9706, 20.4487], "Corregidor (not in 1:10m data)": [120.573, 14.383], "Cebu City": [123.8854, 10.3157],
  "Davao City": [125.6128, 7.0731], "Puerto Princesa, Palawan": [118.7384, 9.7392], "Sibutu, Tawi-Tawi": [119.47, 4.78],
};
const foreign: Record<string, LngLat> = {
  "New Jersey, USA": [-74.4057, 40.0583], "Kota Kinabalu, Sabah": [116.0735, 5.9804], "Sandakan, Sabah": [118.07, 5.84],
  "Kudat, Sabah": [116.84, 6.88], "Malaysian islet nearest the Philippines": [119.195567, 5.128648], "Lanyu, Taiwan": [121.55, 22.05],
  "Kaohsiung, Taiwan": [120.3, 22.62], "Miangas, Indonesia": [126.59, 5.56], "Hong Kong": [114.17, 22.32],
  "Philippine Sea, 170 km offshore": [125.5, 15.0], "South China Sea west of Luzon": [118.5, 16.0],
};

describe("Philippine boundary validation", () => {
  it.each(Object.entries(philippine))("accepts %s", (_, point) => {
    expect(isInPhilippines(point)).toBe(true);
  });

  it.each(Object.entries(foreign))("rejects %s", (_, point) => {
    expect(isInPhilippines(point)).toBe(false);
  });

  it("uses the territorial sea as tolerance, which stays below the 36.5 km gap to the nearest foreign land", () => {
    expect(PH_TERRITORIAL_SEA_KM).toBeLessThan(36.5);
    expect(distanceToPhilippinesKm(philippine["SM Mall of Asia (reclaimed land)"])).toBeLessThan(1);
    expect(distanceToPhilippinesKm(foreign["Malaysian islet nearest the Philippines"], 100)).toBeGreaterThan(PH_TERRITORIAL_SEA_KM);
  });

  it("rejects malformed coordinates", () => {
    expect(isInPhilippines([Number.NaN, 14.6])).toBe(false);
    expect(isInPhilippines([121, 95])).toBe(false);
    expect(isInPhilippines([] as unknown as LngLat)).toBe(false);
  });
});

describe("Philippines-only text search", () => {
  it("resolves Baguio City to Baguio, Benguet", () => {
    expect(philippinePlaceFromTextSearch(search("Baguio City"), "Baguio City")).toMatchObject({ address: "Baguio, Benguet" });
  });

  it("resolves Manila and Clark, Pampanga", () => {
    expect(philippinePlaceFromTextSearch(search("Manila"), "Manila")?.address).toBe("Manila, Metro Manila");
    expect(philippinePlaceFromTextSearch(search("Clark, Pampanga"), "Clark, Pampanga")?.address).toContain("Pampanga");
  });

  it("rejects overseas best matches instead of substituting them", () => {
    expect(philippinePlaceFromTextSearch(search("New Jersey"), "New Jersey")).toBeUndefined();
    expect(philippinePlaceFromTextSearch(search("New Jersey, USA"), "New Jersey, USA")).toBeUndefined();
    expect(philippinePlaceFromTextSearch(search("Paris"), "Paris")).toBeUndefined();
  });

  it("keeps Philippine places whose names also exist abroad", () => {
    expect(philippinePlaceFromTextSearch(search("San Fernando"), "San Fernando")?.address).toBe("San Fernando, Pampanga");
    expect(philippinePlaceFromTextSearch(search("Cambridge"), "Cambridge")?.address).toContain("Metro Manila");
  });

  it("returns nothing for missing or incomplete results", () => {
    expect(philippinePlaceFromTextSearch({}, "x")).toBeUndefined();
    expect(philippinePlaceFromTextSearch({ places: [] }, "x")).toBeUndefined();
    expect(philippinePlaceFromTextSearch({ places: [{ id: "a", formattedAddress: "No location" }] }, "x")).toBeUndefined();
  });

  it("requires both the PH country code and Philippine coordinates", () => {
    const baguio = search("Baguio City").places![0];
    expect(philippinePlaceFromTextSearch({ places: [{ ...baguio, addressComponents: [] }] }, "x")).toBeUndefined();
    expect(philippinePlaceFromTextSearch({ places: [{ ...baguio, location: { latitude: 40.0583, longitude: -74.4057 } }] }, "x")).toBeUndefined();
  });
});

describe("route geometry validation", () => {
  it("keeps recorded Baguio → Manila and Manila → Clark routes", () => {
    expect(routeStaysInPhilippines(route("Baguio→Manila").geometry)).toBe(true);
    expect(routeStaysInPhilippines(route("Manila→Clark").geometry)).toBe(true);
  });

  it("rejects a route whose geometry leaves Philippine territory", () => {
    const base = route("Manila→Clark");
    const toSabah: RouteCandidate = { ...base, id: "via-sabah", geometry: { type: "LineString", coordinates: [...base.geometry.coordinates, foreign["Sandakan, Sabah"]] } };
    expect(routeStaysInPhilippines(toSabah.geometry)).toBe(false);
    expect([base, toSabah].filter((item) => routeStaysInPhilippines(item.geometry)).map((item) => item.id)).toEqual(["Manila→Clark"]);
  });

  it("checks along long straight segments, not only their end points", () => {
    // Balabac and Sibutu are both Philippine, but the straight line between them crosses Sabah's Dent Peninsula.
    const outside = firstPointOutsidePhilippines([[117.05, 7.98], [119.47, 4.78]]);
    expect(outside).toBeDefined();
    expect(isOnPhilippineRoute(outside!)).toBe(false);
  });

  it("accepts inter-island ferry legs through archipelagic waters (recorded Manila → Cebu ferry points)", () => {
    // Both points are >22 km from the 1:10m coastline but inside Philippine internal waters.
    expect(isOnPhilippineRoute([123.8956, 11.60029])).toBe(true); // Visayan Sea
    expect(isOnPhilippineRoute([121.58269, 12.19918])).toBe(true); // Sibuyan Sea
    expect(isOnPhilippineRoute([121.5, 8.5])).toBe(true); // Sulu Sea
  });

  it("rejects foreign land and open ocean for routes, including Sabah inside the archipelago hull", () => {
    for (const point of [[118.07, 5.84], [116.84, 6.88], [118.33, 5.03], [118.61, 4.48], [121.55, 22.05], [126.59, 5.56], [125.5, 15.0]] as LngLat[]) {
      expect(isOnPhilippineRoute(point)).toBe(false);
    }
  });

  it("rejects empty, single-point, and malformed geometry", () => {
    expect(routeStaysInPhilippines(undefined)).toBe(false);
    expect(routeStaysInPhilippines({ coordinates: [[120.98, 14.6]] })).toBe(false);
    expect(routeStaysInPhilippines({ coordinates: [[120.98, 14.6], [Number.NaN, 14.7]] })).toBe(false);
  });

  it("validates a full 249 km route quickly", () => {
    const geometry = route("Baguio→Manila").geometry;
    const started = performance.now();
    for (let run = 0; run < 10; run++) routeStaysInPhilippines(geometry);
    expect((performance.now() - started) / 10).toBeLessThan(50);
  });
});
