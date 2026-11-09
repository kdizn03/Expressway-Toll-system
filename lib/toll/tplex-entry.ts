/** Corrects the common northbound Baguio/La Union approach to TPLEX. */
export function matchedEntryName(expressway: string, routeStartLatitude: number | undefined, sectionStartLatitude: number, sectionEndLatitude: number, nearestEntryName: string) {
  const beganNorthOfRosario = expressway === "TPLEX" && (routeStartLatitude ?? -Infinity) > 16.2 && sectionEndLatitude < sectionStartLatitude;
  return beganNorthOfRosario ? "Rosario" : nearestEntryName;
}
