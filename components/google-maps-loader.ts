"use client";

/**
 * Loads the Maps JavaScript API once per page using Google's recommended async bootstrap
 * (`loading=async` + `google.maps.importLibrary`). Only the browser key is used here.
 */
declare global { interface Window { __luzonGoogleMapsLoad?: Promise<void>; __luzonGoogleMapsReady?: () => void; gm_authFailure?: () => void } }

export const browserKey = () => process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY?.trim() ?? "";
/** Advanced markers need a Map ID; DEMO_MAP_ID works for development, use your own in production. */
export const mapId = () => process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim() || "DEMO_MAP_ID";

const authListeners = new Set<() => void>();
let authFailed = false;
/** Google calls window.gm_authFailure when the key is invalid, restricted, or billing is disabled. */
export function onGoogleMapsAuthFailure(listener: () => void) {
  if (authFailed) listener();
  authListeners.add(listener);
  return () => { authListeners.delete(listener); };
}

export function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps can only load in the browser."));
  if (window.google?.maps && "importLibrary" in window.google.maps) return Promise.resolve();
  if (window.__luzonGoogleMapsLoad) return window.__luzonGoogleMapsLoad;
  const key = browserKey();
  if (!key) return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is not configured."));
  window.gm_authFailure = () => { authFailed = true; authListeners.forEach((listener) => listener()); };
  window.__luzonGoogleMapsLoad = new Promise<void>((resolve, reject) => {
    window.__luzonGoogleMapsReady = () => resolve();
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&language=en&region=PH&callback=__luzonGoogleMapsReady`;
    script.async = true;
    script.onerror = () => { window.__luzonGoogleMapsLoad = undefined; script.remove(); reject(new Error("The Google Maps JavaScript API could not be loaded. Check the network connection.")); };
    document.head.appendChild(script);
  });
  return window.__luzonGoogleMapsLoad;
}

export async function importGoogleLibrary<T extends "maps" | "marker" | "places" | "core">(name: T) {
  await loadGoogleMaps();
  return google.maps.importLibrary(name) as Promise<T extends "maps" ? google.maps.MapsLibrary : T extends "marker" ? google.maps.MarkerLibrary : T extends "places" ? google.maps.PlacesLibrary : google.maps.CoreLibrary>;
}
