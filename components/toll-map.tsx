"use client";

import { useEffect, useRef } from "react";
import { GoogleTollMap } from "./google-toll-map";

export type RouteGeometry = { type: "LineString"; coordinates: [number, number][] };

const emptyRoute: RouteGeometry = { type: "LineString", coordinates: [] };

/** Client-only map with a progressively drawn selected-route overlay. */
export function MapboxTollMap({ route }: { route?: RouteGeometry }) {
  const target = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("mapbox-gl").Map | undefined>(undefined);
  const currentRoute = useRef<RouteGeometry | undefined>(route);
  const frameRef = useRef<number | undefined>(undefined);
  const renderRouteRef = useRef<(value?: RouteGeometry) => void>(() => undefined);

  useEffect(() => {
    currentRoute.current = route;
    renderRouteRef.current(route);
  }, [route]);

  useEffect(() => {
    let cancelled = false;
    let map: import("mapbox-gl").Map | undefined;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || !target.current) return;

    void import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (cancelled || !target.current) return;
      mapboxgl.accessToken = token;
      map = new mapboxgl.Map({
        container: target.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [121.05, 15.25],
        zoom: 7,
      });
      mapRef.current = map;
      map.addControl(new mapboxgl.NavigationControl(), "top-right");

      renderRouteRef.current = (value?: RouteGeometry) => {
        if (!map?.isStyleLoaded()) return;
        const fullRoute = value ?? emptyRoute;
        const base = map.getSource("selected-route") as import("mapbox-gl").GeoJSONSource | undefined;
        const progress = map.getSource("selected-route-progress") as import("mapbox-gl").GeoJSONSource | undefined;
        if (!base || !progress) return;
        base.setData(fullRoute);
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        const coordinates = fullRoute.coordinates;
        if (coordinates.length < 2) { progress.setData(emptyRoute); return; }

        const [first] = coordinates;
        let minLng = first[0]; let maxLng = first[0]; let minLat = first[1]; let maxLat = first[1];
        for (const [lng, lat] of coordinates) { minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); }
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: { top: 120, right: 80, bottom: 260, left: 420 }, duration: 700, maxZoom: 13 });

        const startedAt = performance.now();
        const duration = Math.min(2_400, Math.max(700, coordinates.length * 4));
        const draw = (now: number) => {
          const elapsed = Math.min(1, (now - startedAt) / duration);
          const end = Math.max(2, Math.ceil(elapsed * (coordinates.length - 1)) + 1);
          progress.setData({ type: "LineString", coordinates: coordinates.slice(0, end) });
          if (elapsed < 1) frameRef.current = requestAnimationFrame(draw);
        };
        frameRef.current = requestAnimationFrame(draw);
      };

      map.on("load", () => {
        if (!map) return;
        map.addSource("selected-route", { type: "geojson", data: emptyRoute });
        map.addSource("selected-route-progress", { type: "geojson", data: emptyRoute });
        map.addLayer({ id: "selected-route-casing", type: "line", source: "selected-route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#0b3826", "line-width": 14, "line-opacity": 0.82, "line-blur": 1.2 } });
        map.addLayer({ id: "selected-route-line", type: "line", source: "selected-route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#39ff14", "line-width": 7, "line-opacity": 0.76, "line-blur": 0.35 } });
        map.addLayer({ id: "selected-route-progress", type: "line", source: "selected-route-progress", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#d7ff00", "line-width": 9, "line-opacity": 1, "line-blur": 0.8 } });
        renderRouteRef.current(currentRoute.current);
      });
    });

    return () => {
      cancelled = true;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      renderRouteRef.current = () => undefined;
      mapRef.current = undefined;
      map?.remove();
    };
  }, []);

  return <div ref={target} className="mapCanvas" aria-label="Interactive Luzon map with animated selected route" />;
}

/** Keep the renderer switch independent from server-side route calculations. */
export function TollMap({ route }: { route?: RouteGeometry }) {
  const useGoogle = process.env.NEXT_PUBLIC_MAP_PROVIDER === "google" && Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY);
  return useGoogle ? <GoogleTollMap route={route} /> : <MapboxTollMap route={route} />;
}
