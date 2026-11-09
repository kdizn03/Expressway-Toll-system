"use client";

import { useEffect, useRef } from "react";
import type { RouteGeometry } from "./toll-map";

type GoogleMap = { fitBounds(bounds: unknown, padding?: number | { top: number; right: number; bottom: number; left: number }): void };
type GooglePolyline = { setPath(path: Array<{ lat: number; lng: number }>): void; setMap(map: GoogleMap | null): void };
type GoogleMaps = { Map: new (element: Element, options: object) => GoogleMap; Polyline: new (options: object) => GooglePolyline; LatLngBounds: new () => { extend(point: { lat: number; lng: number }): void } };

declare global { interface Window { google?: { maps?: GoogleMaps }; __luzonGoogleMapsLoad?: Promise<void> } }

function loadGoogleMaps(key: string) {
  if (window.google?.maps) return Promise.resolve();
  if (window.__luzonGoogleMapsLoad) return window.__luzonGoogleMapsLoad;
  window.__luzonGoogleMapsLoad = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps JavaScript API could not load."));
    document.head.appendChild(script);
  });
  return window.__luzonGoogleMapsLoad;
}

export function GoogleTollMap({ route }: { route?: RouteGeometry }) {
  const target = useRef<HTMLDivElement>(null);
  const map = useRef<GoogleMap | undefined>(undefined);
  const baseLine = useRef<GooglePolyline | undefined>(undefined);
  const progressLine = useRef<GooglePolyline | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const latestRoute = useRef(route);

  const renderRoute = (value?: RouteGeometry) => {
    const maps = window.google?.maps; if (!maps || !map.current || !baseLine.current || !progressLine.current) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    const coordinates = value?.coordinates ?? [];
    const path = coordinates.map(([lng, lat]) => ({ lat, lng }));
    baseLine.current.setPath(path);
    if (path.length < 2) { progressLine.current.setPath([]); return; }
    const bounds = new maps.LatLngBounds(); path.forEach((point) => bounds.extend(point)); map.current.fitBounds(bounds, { top: 120, right: 80, bottom: 260, left: 420 });
    const started = performance.now(); const duration = Math.min(2_400, Math.max(700, path.length * 4));
    const draw = (now: number) => {
      const end = Math.max(2, Math.ceil(Math.min(1, (now - started) / duration) * (path.length - 1)) + 1);
      progressLine.current?.setPath(path.slice(0, end));
      if (end < path.length) frame.current = requestAnimationFrame(draw);
    };
    frame.current = requestAnimationFrame(draw);
  };

  useEffect(() => { latestRoute.current = route; renderRoute(route); }, [route]);
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
    if (!key || !target.current) return;
    let active = true;
    void loadGoogleMaps(key).then(() => {
      const maps = window.google?.maps;
      if (!active || !maps || !target.current) return;
      map.current = new maps.Map(target.current, { center: { lat: 15.25, lng: 121.05 }, zoom: 7, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
      baseLine.current = new maps.Polyline({ map: map.current, strokeColor: "#39ff14", strokeOpacity: 0.7, strokeWeight: 8 });
      progressLine.current = new maps.Polyline({ map: map.current, strokeColor: "#d7ff00", strokeOpacity: 1, strokeWeight: 10 });
      renderRoute(latestRoute.current);
    });
    return () => { active = false; if (frame.current) cancelAnimationFrame(frame.current); baseLine.current?.setMap(null); progressLine.current?.setMap(null); };
  }, []);
  return <div ref={target} className="mapCanvas" aria-label="Interactive Google map with animated selected route" />;
}
