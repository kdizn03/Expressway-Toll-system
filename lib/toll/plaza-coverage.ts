import { isInLuzonCoverage } from "../geo/luzon";

/**
 * Every supported expressway is on the Luzon main island, so a plaza locator outside Luzon coverage
 * is a bad geocode (several imported Skyway/SLEX locators point to the Visayas or Mindanao). Such
 * records are ignored by the matcher; they are not modified or deleted. Wrong locators that still lie
 * on Luzon (e.g. some placed in Cagayan) cannot be detected here and need the locator repair.
 */
export function usablePlazas<T extends { latitude: number; longitude: number }>(plazas: T[]): T[] {
  return plazas.filter((plaza) => isInLuzonCoverage([plaza.longitude, plaza.latitude]));
}
