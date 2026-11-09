export function nlexBoundaryPlazas(routeStartLatitude: number | undefined, routeEndLatitude: number | undefined, sectionStartLatitude: number, sectionEndLatitude: number, entry: string, exit: string) {
  return {
    entry: (routeStartLatitude ?? -Infinity) > 15.2 && sectionStartLatitude > 15.1 ? "Sta. Ines" : entry,
    exit: (routeEndLatitude ?? Infinity) < 14.7 && sectionEndLatitude < 14.8 ? "Balintawak" : exit,
  };
}

export function skywayStage3BoundaryPlazas(routeStartLatitude: number | undefined, sectionStartLatitude: number, sectionEndLatitude: number, entry: string, exit: string) {
  const fromNorthernLuzon = (routeStartLatitude ?? -Infinity) > 15.2;
  const southbound = sectionEndLatitude < sectionStartLatitude;
  const collapsedPair = entry === exit;
  return fromNorthernLuzon && (southbound || collapsedPair) ? { entry: "Balintawak", exit: "E. Rodriguez" } : { entry, exit };
}
