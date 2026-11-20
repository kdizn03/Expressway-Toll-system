import { describe, expect, it } from "vitest";
import { firstPointOutsideLuzon, isInLuzonCoverage, LUZON_COASTAL_TOLERANCE_KM, routeStaysInLuzon } from "../lib/geo/luzon";
import type { LngLat } from "../lib/geo/polygon";
import { luzonPlaceFromTextSearch, type TextSearchResponse } from "../lib/routing/google";
import { normalizeGoogleRoutes, type GoogleRoutesResponse } from "../lib/routing/google-route-adapter";
import { expresswayCoverage, keepLuzonRoutes, LUZON_LOCATION_ERROR, resolveTripLocation } from "../lib/routing/trip-validation";
import type { ResolvedPlace } from "../lib/routing/types";
import { identifyExpressway } from "../lib/toll/expressway-aliases";
import { usablePlazas } from "../lib/toll/plaza-coverage";
import recorded from "./fixtures/google-luzon-recorded.json";

// Places and Routes responses below were RECORDED from the live Google APIs
// (tests/fixtures/google-luzon-recorded.json, 2026-11-19). These tests make no network calls.
type Query = keyof typeof recorded.places;
type RouteName = keyof typeof recorded.routes;
const search = (query: Query) => recorded.places[query] as TextSearchResponse;
const resolveRecorded = async (text: string): Promise<ResolvedPlace | undefined> => text in recorded.places ? luzonPlaceFromTextSearch(search(text as Query), text) : undefined;
const route = (name: RouteName) => normalizeGoogleRoutes(recorded.routes[name] as GoogleRoutesResponse)[0];
/** Expressways the shared alias table recognises on a normalized route (the matcher's first step). */
const expresswaysOn = (name: RouteName) => [...new Set(route(name).steps.map((step) => identifyExpressway(step.name, step.ref) ?? (step.ref === "E1" ? "NLEX/TPLEX (E1)" : undefined)).filter(Boolean))];

describe("Luzon coverage boundary", () => {
  const inside: Record<string, LngLat> = {
    "Baguio City": [120.596, 16.4023], "Quezon City": [121.051, 14.649], "Angeles City": [120.609, 15.161], "Tarlac City": [120.587, 15.488],
    "San Fernando City, La Union": [120.321, 16.616], "Naga City, Camarines Sur": [123.27, 13.648], "Aparri (northern tip)": [121.6406, 18.3565],
    "Matnog (southern tip)": [124.0858, 12.5856], "SM Mall of Asia (reclaimed)": [120.9822, 14.5352], "Subic port": [120.2667, 14.8167],
  };
  const outside: Record<string, LngLat> = {
    "Cebu City (Visayas)": [123.902, 10.293], "Iloilo City (Visayas)": [122.559, 10.73], "Davao City (Mindanao)": [125.609, 7.065],
    "Puerto Galera, Mindoro": [120.955, 13.5], "Calapan, Mindoro": [121.18, 13.41], "Boac, Marinduque": [121.84, 13.45],
    "Virac, Catanduanes": [124.175, 13.619], "Masbate City": [123.617, 12.368], "Basco, Batanes": [121.9706, 20.4487],
    "Corregidor (ferry only)": [120.573, 14.383], "Polillo Island": [121.95, 14.72], "Tokyo": [139.65, 35.676],
    "Manila Bay, 10 km offshore": [120.85, 14.55], "Rectangle corner inside the search bounds": [119.8, 18.6],
  };
  it.each(Object.entries(inside))("accepts %s", (_, point) => expect(isInLuzonCoverage(point)).toBe(true));
  it.each(Object.entries(outside))("rejects %s", (_, point) => expect(isInLuzonCoverage(point)).toBe(false));

  it("rejects malformed coordinates", () => {
    expect(isInLuzonCoverage([Number.NaN, 15])).toBe(false);
    expect(isInLuzonCoverage([121, 200])).toBe(false);
    expect(isInLuzonCoverage(undefined as unknown as LngLat)).toBe(false);
  });

  it("keeps the coastal tolerance far below the gap to the nearest ferry-only island (Corregidor, 6.5 km)", () => {
    expect(LUZON_COASTAL_TOLERANCE_KM).toBeLessThan(6.5);
  });
});

describe("Luzon-only text search", () => {
  it.each(["Baguio City, Benguet", "Quezon City, Metro Manila", "Angeles City, Pampanga", "Tarlac City, Tarlac", "San Fernando City, La Union", "Naga City, Camarines Sur", "Clark"] as Query[])("accepts %s", (query) => {
    expect(luzonPlaceFromTextSearch(search(query), query)?.address).toBe(search(query).places![0].formattedAddress);
  });

  it.each(["Cebu City", "Iloilo City", "Davao City", "Puerto Galera", "Virac", "Tokyo"] as Query[])("rejects %s instead of substituting a Luzon place", (query) => {
    expect(luzonPlaceFromTextSearch(search(query), query)).toBeUndefined();
  });

  it("resolves the ambiguous name 'Naga' (Cebu or Camarines Sur) to the Luzon city only because it is inside coverage", () => {
    const place = luzonPlaceFromTextSearch(search("Naga"), "Naga");
    expect(place?.address).toBe("Naga City, Camarines Sur");
    expect(isInLuzonCoverage(place!.coordinate)).toBe(true);
  });

  it("does not rely on the address text: a Luzon-looking address with Visayas coordinates is rejected", () => {
    const tarlac = search("Tarlac City, Tarlac").places![0];
    expect(luzonPlaceFromTextSearch({ places: [{ ...tarlac, location: { latitude: 10.293, longitude: 123.902 } }] }, "x")).toBeUndefined();
  });
});

describe("server-side trip validation", () => {
  const trip = async (from: string, to: string) => [await resolveTripLocation(from, undefined, resolveRecorded), await resolveTripLocation(to, undefined, resolveRecorded)];

  it.each([["Baguio City, Benguet", "Quezon City, Metro Manila"], ["Baguio City, Benguet", "Clark"], ["Quezon City, Metro Manila", "Tarlac City, Tarlac"], ["Quezon City, Metro Manila", "Naga City, Camarines Sur"]])("accepts %s → %s", async (from, to) => {
    expect((await trip(from, to)).map((result) => result.ok)).toEqual([true, true]);
  });

  it.each([["Quezon City, Metro Manila", "Cebu City"], ["Baguio City, Benguet", "Davao City"], ["Quezon City, Metro Manila", "Iloilo City"], ["Quezon City, Metro Manila", "Tokyo"]])("rejects %s → %s with the coverage message", async (from, to) => {
    const [origin, destination] = await trip(from, to);
    expect(origin.ok).toBe(true);
    expect(destination).toEqual({ ok: false, message: LUZON_LOCATION_ERROR });
  });

  it("re-checks browser-supplied coordinates for an autocomplete selection", async () => {
    const neverCalled = async () => { throw new Error("text search must not run for a selection"); };
    expect(await resolveTripLocation("SM Seaside", { placeId: "x", latitude: 10.282, longitude: 123.88 }, neverCalled)).toEqual({ ok: false, message: LUZON_LOCATION_ERROR });
    expect((await resolveTripLocation("SM City Clark", { placeId: "y", latitude: 15.1675, longitude: 120.5801 }, neverCalled)).ok).toBe(true);
  });

  it("rejects places the geocoder could not find", async () => {
    expect(await resolveTripLocation("zzqq", undefined, async () => undefined)).toEqual({ ok: false, message: LUZON_LOCATION_ERROR });
  });
});

describe("route geometry and expressway coverage", () => {
  it.each(["Baguio→Clark", "Manila→Tarlac City", "Manila→Naga City", "Baguio→La Trinidad"] as RouteName[])("keeps the recorded %s route inside Luzon", (name) => {
    expect(routeStaysInLuzon(route(name).geometry)).toBe(true);
  });

  it("drops a route that crosses outside coverage (recorded Manila → Cebu ferry route)", () => {
    const cebu = route("Manila→Cebu City");
    const outsidePoint = firstPointOutsideLuzon(cebu.geometry.coordinates);
    expect(outsidePoint).toBeDefined();
    expect(isInLuzonCoverage(outsidePoint!)).toBe(false);
    expect(keepLuzonRoutes([route("Manila→Tarlac City"), cebu]).map((item) => item.geometry)).toEqual([route("Manila→Tarlac City").geometry]);
  });

  it("identifies supported expressways on recorded toll routes", () => {
    expect(expresswaysOn("Baguio→Clark")).toEqual(expect.arrayContaining(["TPLEX", "SCTEX"]));
    expect(expresswaysOn("Manila→Tarlac City")).toEqual(expect.arrayContaining(["NLEX/TPLEX (E1)"]));
    expect(expresswaysOn("Manila→Naga City").length).toBeGreaterThan(0);
    expect(expresswayCoverage(route("Baguio→Clark"), 2)).toBe("SUPPORTED_EXPRESSWAY");
  });

  it("classifies a Luzon route without any toll road as ordinary roads (no expressway toll applies)", () => {
    const local = route("Baguio→La Trinidad");
    expect(local.steps.every((step) => step.tolled === false)).toBe(true);
    expect(expresswaysOn("Baguio→La Trinidad")).toEqual([]);
    expect(expresswayCoverage(local, 0)).toBe("NO_TOLL_ROAD");
  });

  it("never shows a tolled route the matcher cannot price as free", () => {
    expect(expresswayCoverage(route("Manila→Tarlac City"), 0)).toBe("UNSUPPORTED_TOLL_ROAD");
  });
});

describe("toll plaza locators", () => {
  it("ignores plaza records whose coordinates are off Luzon (bad geocodes), keeping the rest", () => {
    // Real locator values from the database. The Buendia locator is wrong but lies on Luzon (Cagayan),
    // so the coverage filter cannot detect it; that needs the plaza-locator repair.
    const plazas = [
      { name: "Balintawak", latitude: 14.656, longitude: 120.997 },
      { name: "Buendia (bad locator, Cagayan)", latitude: 18.303, longitude: 121.594 },
      { name: "Calamba (bad locator, Mindanao)", latitude: 8.558, longitude: 123.645 },
      { name: "Balintawak (Skyway 3) (bad locator, Visayas)", latitude: 10.84, longitude: 123.496 },
      { name: "Sta. Ines", latitude: 15.215, longitude: 120.59 },
    ];
    expect(usablePlazas(plazas).map((plaza) => plaza.name)).toEqual(["Balintawak", "Buendia (bad locator, Cagayan)", "Sta. Ines"]);
  });
});
