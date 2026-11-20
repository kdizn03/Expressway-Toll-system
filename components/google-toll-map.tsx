"use client";

import { useEffect, useRef, useState } from "react";
import { browserKey, importGoogleLibrary, mapId, onGoogleMapsAuthFailure } from "./google-maps-loader";
import type { MapPlace, RouteGeometry } from "./toll-map";

const LUZON_CENTER = { lat: 15.25, lng: 121.05 };
const toPath = (route?: RouteGeometry) => (route?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }));

/** Even padding around a fitted route, scaled down so small (mobile) map panes never over-constrain the fit. */
function routePadding(container: HTMLElement) {
  const inset = Math.round(Math.max(24, Math.min(72, Math.min(container.clientWidth, container.clientHeight) * 0.12)));
  return { top: inset + 24, right: inset, bottom: inset, left: inset };
}

type Props = { routes: RouteGeometry[]; selected: number; onSelect?: (index: number) => void; origin?: MapPlace; destination?: MapPlace };
type Layers = { casing: google.maps.Polyline; base: google.maps.Polyline; progress: google.maps.Polyline; alternatives: google.maps.Polyline[]; originMarker: google.maps.marker.AdvancedMarkerElement; destinationMarker: google.maps.marker.AdvancedMarkerElement };

export function GoogleTollMap({ routes = [], selected = 0, onSelect, origin, destination }: Props) {
  const target = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | undefined>(undefined);
  const layers = useRef<Layers | undefined>(undefined);
  const libraries = useRef<{ maps: google.maps.MapsLibrary; core: google.maps.CoreLibrary } | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const latest = useRef({ routes, selected, origin, destination, onSelect });
  latest.current = { routes, selected, origin, destination, onSelect };
  const [status, setStatus] = useState<{ state: "loading" | "ready" | "error"; message?: string }>(() => browserKey() ? { state: "loading" } : { state: "error", message: "Map unavailable: set NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY and restart the app." });

  // Drawing overlays must never take the whole map down: log and keep the base map usable.
  const render = () => {
    try { draw(); } catch (error) { console.error("[map] could not draw the route overlay", error); }
  };
  const draw = () => {
    const current = layers.current; const instance = map.current; const libs = libraries.current;
    if (!current || !instance || !libs) return;
    const { selected: selectedIndex, origin: from, destination: to } = latest.current;
    const allRoutes = (Array.isArray(latest.current.routes) ? latest.current.routes : []).filter((route): route is RouteGeometry => Array.isArray(route?.coordinates));
    if (frame.current) cancelAnimationFrame(frame.current);

    // Unselected alternatives stay visible (and clickable) beneath the highlighted route.
    current.alternatives.forEach((line) => line.setMap(null));
    current.alternatives = allRoutes.flatMap((route, index) => index === selectedIndex || route.coordinates.length < 2 ? [] : [(() => {
      const line = new libs.maps.Polyline({ map: instance, path: toPath(route), strokeColor: "#5f7268", strokeOpacity: 0.55, strokeWeight: 6, zIndex: 1, clickable: true });
      line.addListener("click", () => latest.current.onSelect?.(index));
      return line;
    })()]);

    const path = toPath(allRoutes[selectedIndex]);
    current.casing.setPath(path); current.base.setPath(path);
    current.originMarker.position = from ? { lat: from.latitude, lng: from.longitude } : null;
    current.originMarker.title = from ? `Origin: ${from.name}` : "";
    current.destinationMarker.position = to ? { lat: to.latitude, lng: to.longitude } : null;
    current.destinationMarker.title = to ? `Destination: ${to.name}` : "";
    if (path.length < 2) { current.progress.setPath([]); return; }

    const bounds = new libs.core.LatLngBounds(); path.forEach((point) => bounds.extend(point));
    if (from) bounds.extend({ lat: from.latitude, lng: from.longitude });
    if (to) bounds.extend({ lat: to.latitude, lng: to.longitude });
    instance.fitBounds(bounds, target.current ? routePadding(target.current) : 48);

    const started = performance.now(); const duration = Math.min(2_400, Math.max(700, path.length * 4));
    const animate = (now: number) => {
      const end = Math.max(2, Math.ceil(Math.min(1, (now - started) / duration) * (path.length - 1)) + 1);
      current.progress.setPath(path.slice(0, end));
      if (end < path.length) frame.current = requestAnimationFrame(animate);
    };
    frame.current = requestAnimationFrame(animate);
  };

  // Re-render overlays when routes, selection, or markers change; the map itself is created once.
  useEffect(() => { render(); }, [routes, selected, origin, destination]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!browserKey() || !target.current) return;
    let active = true;
    const stopAuth = onGoogleMapsAuthFailure(() => setStatus({ state: "error", message: "Google Maps rejected the browser API key. Check the key, its HTTP-referrer restrictions, and that billing and the Maps JavaScript API are enabled." }));
    void Promise.all([importGoogleLibrary("maps"), importGoogleLibrary("marker"), importGoogleLibrary("core")]).then(([maps, marker, core]) => {
      if (!active || !target.current) return;
      const instance = new maps.Map(target.current, {
        center: LUZON_CENTER, zoom: 7, mapId: mapId(),
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false,
        zoomControl: true, cameraControl: false, gestureHandling: "auto",
      });
      map.current = instance; libraries.current = { maps, core };
      const pin = (glyphText: string, background: string, borderColor: string) => new marker.PinElement({ glyphText, background, borderColor, glyphColor: "#ffffff", scale: 1.1 });
      layers.current = {
        casing: new maps.Polyline({ map: instance, strokeColor: "#0b3826", strokeOpacity: 0.82, strokeWeight: 14, zIndex: 2, clickable: false }),
        base: new maps.Polyline({ map: instance, strokeColor: "#39ff14", strokeOpacity: 0.76, strokeWeight: 7, zIndex: 3, clickable: false }),
        progress: new maps.Polyline({ map: instance, strokeColor: "#d7ff00", strokeOpacity: 1, strokeWeight: 9, zIndex: 4, clickable: false }),
        alternatives: [],
        originMarker: new marker.AdvancedMarkerElement({ map: instance, content: pin("A", "#135f43", "#0b3826"), zIndex: 10 }),
        destinationMarker: new marker.AdvancedMarkerElement({ map: instance, content: pin("B", "#e36d37", "#a94a1f"), zIndex: 10 }),
      };
      setStatus((value) => value.state === "error" ? value : { state: "ready" });
      render();
    }).catch((error: unknown) => { if (active) setStatus({ state: "error", message: error instanceof Error ? error.message : "Google Maps could not be loaded." }); });
    return () => {
      active = false; stopAuth();
      if (frame.current) cancelAnimationFrame(frame.current);
      const current = layers.current;
      if (current) { [current.casing, current.base, current.progress, ...current.alternatives].forEach((line) => line.setMap(null)); current.originMarker.map = null; current.destinationMarker.map = null; }
      layers.current = undefined; map.current = undefined;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <>
    <div ref={target} className="mapCanvas" aria-label="Interactive Google map of Luzon with the selected route" />
    {status.state !== "ready" && <div className={`mapStatus ${status.state === "error" ? "error" : ""}`} role={status.state === "error" ? "alert" : "status"}>{status.state === "error" ? status.message : "Loading Google Maps…"}</div>}
  </>;
}
