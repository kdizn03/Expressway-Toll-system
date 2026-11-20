"use client";

import { GoogleTollMap } from "./google-toll-map";

export type RouteGeometry = { type: "LineString"; coordinates: [number, number][] };
export type MapPlace = { name: string; address?: string; latitude: number; longitude: number };

/** The planner's map: Google Maps with the selected route highlighted and alternatives selectable. */
export function TollMap(props: { routes: RouteGeometry[]; selected: number; onSelect?: (index: number) => void; origin?: MapPlace; destination?: MapPlace }) {
  return <GoogleTollMap {...props} />;
}
