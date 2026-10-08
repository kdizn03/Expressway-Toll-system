"use client";
import { useEffect, useRef } from "react";

/** Client-only Mapbox shell; route data is supplied by the server, never fabricated here. */
export function TollMap() {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import("mapbox-gl").Map | undefined;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || !target.current) return;
    void import("mapbox-gl").then(({ default: mapboxgl }) => {
      mapboxgl.accessToken = token;
      map = new mapboxgl.Map({ container: target.current!, style: "mapbox://styles/mapbox/streets-v12", center: [121.05, 15.25], zoom: 7 });
      map.addControl(new mapboxgl.NavigationControl(), "top-right");
    });
    return () => map?.remove();
  }, []);
  return <div ref={target} className="mapCanvas" aria-label="Interactive Luzon map" />;
}
