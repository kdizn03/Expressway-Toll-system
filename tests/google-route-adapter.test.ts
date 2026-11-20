import { describe, expect, it } from "vitest";
import { decodePolyline, labelGoogleRoad, normalizeGoogleRoutes, normalizeGoogleSteps, parseInstruction, type GoogleRouteStep } from "../lib/routing/google-route-adapter";
import { identifyExpressway } from "../lib/toll/expressway-aliases";
import { googleErrorFromResponse } from "../lib/routing/errors";
import { preciseAlias } from "../lib/routing/place-aliases";

// Unit tests with RECORDED Google Routes instruction strings (captured Nov 2026). No live API calls.
const step = (instructions: string, start: [number, number], end: [number, number], distanceMeters = 1000): GoogleRouteStep => ({
  distanceMeters, staticDuration: "60s", navigationInstruction: { instructions },
  startLocation: { latLng: { latitude: start[1], longitude: start[0] } }, endLocation: { latLng: { latitude: end[1], longitude: end[0] } },
});
const codes = (steps: GoogleRouteStep[]) => normalizeGoogleSteps(steps).map((item) => identifyExpressway(item.name, item.ref) ?? (item.ref === "E1" ? "E1" : null));

describe("Google instruction parsing", () => {
  it("reads the travelled road and the toll-road marker", () => {
    expect(parseInstruction("Merge onto N Luzon Expy/E1/R-8\nToll road")).toEqual({ road: "N Luzon Expy/E1/R-8", tolled: true });
    expect(parseInstruction("Keep left to continue on N Luzon Expy/Maharlika Hwy/AH26/E1/R-8\nToll road").road).toContain("N Luzon Expy");
  });

  it("ignores destination signage so an exit toward NLEX is not counted as NLEX", () => {
    expect(parseInstruction("Take exit 88 toward Manila/NLEX\nToll road")).toEqual({ road: undefined, tolled: true });
    expect(parseInstruction("Keep right, follow signs for Calamba/SLEX\nToll road").road).toBeUndefined();
  });

  it("drops 'Pass by' landmarks and uses 'Continue to follow' when needed", () => {
    expect(parseInstruction("Turn right onto A. Bonifacio Ave/R-8\nContinue to follow R-8\nToll road\nPass by Ping Ping's (on the right)")).toEqual({ road: "A. Bonifacio Ave/R-8", tolled: true });
  });
});

describe("Google road labels", () => {
  it("expands Google abbreviations in the shared alias table", () => {
    expect(identifyExpressway("N Luzon Expy/E1/R-8")).toBe("NLEX");
    expect(identifyExpressway("Calabarzon Expy/STAR Tollway")).toBe("STAR");
    expect(identifyExpressway("Cavitex/Manila - Cavite Expy/E3/R-1")).toBe("CAVITEX");
    expect(identifyExpressway("NLEX Connector Rd")).toBe("NLEX_CONNECTOR");
  });

  it("splits the shared 'N Luzon W Expy' label into SCTEX or TPLEX by latitude", () => {
    expect(labelGoogleRoad("N Luzon W Expy", true, 15.0)?.name).toBe("SCTEX");
    expect(labelGoogleRoad("N Luzon W Expy/Tarlac-Pangasinan-La Un Expy/R-8", true, 15.8)?.name).toBe("TPLEX");
    expect(labelGoogleRoad("N Luzon W Expy/Subic - Clark - Tarlac Expy/Tarlac-Pangasinan-La Un Expy/TPLEx/R-8", true, 15.2)?.name).toBe("SCTEX");
    // Ramp signage near Clark names TPLEX, but TPLEX does not exist south of Tarlac City.
    expect(labelGoogleRoad(parseInstruction("Slight right onto the ramp to Clark North/Concepcion/Tarlac City/Baguio/TPLEX\nToll road").road ?? "", true, 15.197)?.name).toBe("SCTEX");
  });

  it("uses route numbers only for tolled stretches", () => {
    expect(labelGoogleRoad("R-3", true, 14.3)?.name).toBe("SLEX");
    expect(labelGoogleRoad("R-3", false, 14.3)).toBeUndefined();
    expect(labelGoogleRoad("A. Bonifacio Ave/R-8", true, 14.9)?.ref).toBe("E1");
    expect(labelGoogleRoad("E6", true, 14.52)?.name).toBe("NAIAX");
  });
});

describe("Google step normalization", () => {
  it("carries the expressway through unnamed tolled steps and stops at untolled roads (Manila → Clark)", () => {
    expect(codes([
      step("Turn right onto A. Bonifacio Ave/R-8\nContinue to follow R-8\nToll road", [120.99, 14.626], [120.59, 15.176], 77521),
      step("Take exit 83 toward Dau\nToll road", [120.59, 15.176], [120.59, 15.179]),
      step("Take the ramp to Manila North Rd\nToll road", [120.59, 15.179], [120.59, 15.17]),
      step("At the roundabout, take the 3rd exit onto Manuel A. Roxas Hwy", [120.59, 15.17], [120.56, 15.18]),
    ])).toEqual(["E1", "E1", "E1", null]);
  });

  it("follows Skyway → SLEX → STAR toward Batangas", () => {
    expect(codes([
      step("Keep right and merge onto Metro Manila Skyway\nToll road", [121.0, 14.577], [121.04, 14.44]),
      step("Keep right, follow signs for Calamba/SLEX\nToll road", [121.04, 14.44], [121.04, 14.405]),
      step("Merge onto R-3\nToll road", [121.04, 14.405], [121.1, 14.123]),
      step("Continue onto Calabarzon Expy/STAR Tollway\nToll road", [121.1, 14.123], [121.06, 13.8]),
    ])).toEqual(["SKYWAY", "SKYWAY", "SLEX", "STAR"]);
  });

  it("splits Google's single TPLEX → SCTEX step at the Tarlac junction (Baguio → Clark)", () => {
    const steps = normalizeGoogleSteps([
      step("At the roundabout, take the 3rd exit onto Tarlac-Pangasinan-La Un Expy\nToll road", [120.6, 16.225], [120.57, 16.002], 27658),
      step("Continue onto N Luzon W Expy/Tarlac-Pangasinan-La Un Expy/R-8\nToll road", [120.57, 16.002], [120.59, 15.201], 96261),
      step("Take exit 88 toward Manila/NLEX\nToll road", [120.59, 15.201], [120.59, 15.197], 819),
    ]);
    expect(steps.map((item) => identifyExpressway(item.name))).toEqual(["TPLEX", "TPLEX", "SCTEX", "SCTEX"]);
    // TPLEX ends at its La Paz plaza; SCTEX begins at its Tarlac plaza.
    expect(steps[1].end).toEqual([120.7284, 15.4408]);
    expect(steps[2].start).toEqual([120.5885, 15.4872]);
    expect(steps[1].distanceMeters + steps[2].distanceMeters).toBeCloseTo(96261);
  });

  it("keeps untolled at-grade expressway names visible to the toll engine but marked untolled", () => {
    const [normalized] = normalizeGoogleSteps([step("Turn left onto Osmeña Hwy/South Luzon Expy/R-3", [121.0, 14.577], [121.02, 14.555])]);
    expect(identifyExpressway(normalized.name)).toBe("SLEX");
    expect(normalized.tolled).toBe(false);
  });
});

describe("Google route normalization", () => {
  it("decodes the encoded polyline into [lng, lat] pairs", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  });

  it("returns distinct geometry, distance and duration per alternative and drops routes without geometry", () => {
    const routes = normalizeGoogleRoutes({ routes: [
      { distanceMeters: 1000, duration: "120s", polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC" }, legs: [] },
      { distanceMeters: 2000, duration: "300s", polyline: { encodedPolyline: "_p~iF~ps|U_mqNvxq`@" }, legs: [] },
      { distanceMeters: 5, duration: "1s", polyline: { encodedPolyline: "" } },
    ] }, false);
    expect(routes.map((route) => [route.id, route.distanceMeters, route.durationSeconds])).toEqual([["google-drive-0", 1000, 120], ["google-drive-1", 2000, 300]]);
    expect(routes[0].geometry.coordinates).not.toEqual(routes[1].geometry.coordinates);
  });
});

describe("Google error mapping and place aliases", () => {
  it("turns Google API failures into understandable messages", () => {
    expect(googleErrorFromResponse("routes", 429, { error: { status: "RESOURCE_EXHAUSTED" } }).code).toBe("QUOTA_EXCEEDED");
    expect(googleErrorFromResponse("places", 403, { error: { status: "PERMISSION_DENIED", message: "API key not valid" } }).userMessage).toMatch(/server API key/);
    expect(googleErrorFromResponse("routes", 403, { error: { status: "PERMISSION_DENIED", message: "This API requires billing to be enabled" } }).userMessage).toMatch(/billing/);
    expect(googleErrorFromResponse("routes", 400, { error: { status: "INVALID_ARGUMENT" } }).httpStatus).toBe(422);
  });

  it("keeps the precise Metro Manila aliases for typed places", () => {
    expect(preciseAlias("Sampaloc, Manila")).toEqual([121.0022, 14.6031]);
    expect(preciseAlias("Kabatas, Taguig")).toEqual([121.036582, 14.533484]);
  });
});
