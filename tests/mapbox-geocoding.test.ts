import { describe, expect, it } from "vitest";
import { geocode } from "../lib/routing/mapbox";

describe("Philippine geocoding safeguards", () => {
  it("uses the Manila district rather than a same-named provincial locality", async () => {
    await expect(geocode("Sampaloc, Manila")).resolves.toEqual([121.0022, 14.6031]);
  });

  it("keeps Kabatas in Western Bicutan instead of the generic Taguig label", async () => {
    await expect(geocode("Kabatas, Taguig")).resolves.toEqual([121.036582, 14.533484]);
  });
});
