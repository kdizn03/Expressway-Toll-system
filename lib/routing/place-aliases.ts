import type { Coordinate } from "./types";

// Free-text searches can return a same-named locality in a different province.
// Keep a very small, documented set of unambiguous local aliases for typed
// (not autocomplete-selected) Metro Manila places.
const precisePhilippineAliases: Record<string, Coordinate> = {
  "sampaloc, manila": [121.0022, 14.6031],
  "sampaloc, manila, philippines": [121.0022, 14.6031],
  // Kabatas Compound is in Western Bicutan, beside Lawton Avenue—not Taguig's
  // city-label point. This locator is deliberately limited to the compound.
  "kabatas, taguig": [121.036582, 14.533484],
  "kabatas, taguig, metro manila": [121.036582, 14.533484],
  "kabatas compound, taguig": [121.036582, 14.533484],
};
const normalizePlace = (place: string) => place.trim().toLocaleLowerCase("en-PH").replace(/\s+/g, " ");

export function preciseAlias(place: string): Coordinate | undefined {
  return precisePhilippineAliases[normalizePlace(place)];
}
