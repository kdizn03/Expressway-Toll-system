/** Buendia plaza: the hand-off between Skyway Stage 3 (north) and Skyway Stages 1–2 (south). Location verified from OpenStreetMap. */
export const SKYWAY_BUENDIA: [number, number] = [121.0045, 14.5634];

/** Returns the Buendia boundary when a Skyway section runs from Stage 3 into Stages 1–2 (either direction). */
export function skywayStageSplit(start: [number, number], end: [number, number]) {
  // ~400 m margins: Plaza Dilao, the nearest Stage 3 ramp, is only ~0.9 km north of Buendia.
  const north = (point: [number, number]) => point[1] > SKYWAY_BUENDIA[1] + 0.004;
  const south = (point: [number, number]) => point[1] < SKYWAY_BUENDIA[1] - 0.004;
  return (north(start) && south(end)) || (south(start) && north(end)) ? { boundary: SKYWAY_BUENDIA } : undefined;
}
