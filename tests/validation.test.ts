import { describe, expect, it } from "vitest";
import { routeSearchSchema } from "../lib/validation";

describe("route search validation", () => {
  const valid = { origin: "Manila", destination: "Baguio City", vehicleClass: "CLASS_1", roundTrip: false };
  it("accepts valid search input", () => expect(routeSearchSchema.safeParse(valid).success).toBe(true));
  it("rejects identical endpoints and oversized input", () => {
    expect(routeSearchSchema.safeParse({ ...valid, destination: "manila" }).success).toBe(false);
    expect(routeSearchSchema.safeParse({ ...valid, origin: "a".repeat(161) }).success).toBe(false);
  });
});
