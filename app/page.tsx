"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { TollMap, type MapPlace, type RouteGeometry } from "@/components/toll-map";
import { PlaceAutocomplete, type SelectedPlace } from "@/components/place-autocomplete";
import { AuthLinks } from "@/components/auth-links";

type TollStatus = "VERIFIED" | "ESTIMATED" | "INCOMPLETE" | "UNAVAILABLE";
type RouteMode = "FASTEST" | "CHEAPEST" | "BALANCED" | "AVOID_TOLLS";
type TollSegment = { expressway: string; exitExpressway?: string; entry: string; exit: string; vehicleClass: "CLASS_1" | "CLASS_2" | "CLASS_3"; tollCentavos?: number; estimate?: boolean; warning?: string };
type Toll = { totalCentavos?: number; status: TollStatus; tollsAvoided?: boolean; noExpressway?: boolean; segments: TollSegment[]; warnings?: string[] };
type Result = { id: string; mode: RouteMode; preferences?: RouteMode[]; distanceMeters: number; durationSeconds: number; expressways: string[]; toll: Toll; geometry: RouteGeometry };

const labels: Record<RouteMode, string> = { FASTEST: "FASTEST", CHEAPEST: "CHEAPEST", BALANCED: "BALANCED", AVOID_TOLLS: "AVOID TOLLS" };
const formatTime = (seconds: number) => `${Math.floor(seconds / 3600)} hr ${Math.round((seconds % 3600) / 60)} min`;
const vehicleLabel = (vehicle: TollSegment["vehicleClass"]) => vehicle.replace("_", " ");
const currency = (centavos: number) => `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
const databaseOffline = (toll: Toll) => toll.segments.some((segment) => segment.warning?.includes("Rate database is currently unavailable"));

function tollText(toll: Toll) {
  if (toll.tollsAvoided) return "₱0 · tolls avoided";
  if (toll.noExpressway) return "₱0 · no expressway toll applies";
  if (databaseOffline(toll)) return "Toll data unavailable";
  if (toll.totalCentavos !== undefined) return currency(toll.totalCentavos);
  return toll.status === "UNAVAILABLE" ? "Rate unavailable" : toll.status === "INCOMPLETE" ? "Incomplete toll data" : "Estimated toll";
}

export default function Home() {
  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ origin?: string; destination?: string }>({});
  const [unavailablePreferences, setUnavailablePreferences] = useState<RouteMode[]>([]);
  const [coverageNotice, setCoverageNotice] = useState("");
  const [places, setPlaces] = useState({ origin: "", destination: "" });
  const [originInput, setOriginInput] = useState<{ text: string; place?: SelectedPlace }>({ text: "Baguio City" });
  const [destinationInput, setDestinationInput] = useState<{ text: string; place?: SelectedPlace }>({ text: "Manila" });
  const [markers, setMarkers] = useState<{ origin?: MapPlace; destination?: MapPlace }>({});
  const routeGeometries = useMemo(() => results.map((route) => route.geometry), [results]);
  const [fuelEfficiency, setFuelEfficiency] = useState("");
  const [fuelPrice, setFuelPrice] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [access, setAccess] = useState<"checking" | "welcome" | "dashboard">("checking");
  const [authEnabled, setAuthEnabled] = useState(false);
  const selectedRoute = results[selected];
  const fuelEstimate = useMemo(() => {
    const efficiency = Number(fuelEfficiency); const price = Number(fuelPrice);
    if (!selectedRoute || !Number.isFinite(efficiency) || efficiency <= 0 || !Number.isFinite(price) || price <= 0) return undefined;
    return selectedRoute.distanceMeters / 1000 / efficiency * price;
  }, [selectedRoute, fuelEfficiency, fuelPrice]);

  useEffect(() => { fetch("/api/auth/session").then((response) => response.json()).then((body) => { const enabled = Boolean(body.authEnabled); const authenticated = enabled && Boolean(body.user); setAuthEnabled(enabled); setSignedIn(authenticated); setAccess(authenticated || !enabled ? "dashboard" : "welcome"); }).catch(() => setAccess("dashboard")); }, []);

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fieldErrors.origin || fieldErrors.destination) return;
    setLoading(true); setError(""); setCoverageNotice(""); setResults([]); setUnavailablePreferences([]);
    const form = new FormData(event.currentTarget);
    const origin = originInput.text.trim(); const destination = destinationInput.text.trim();
    try {
      const response = await fetch("/api/routes/calculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin, destination, originPlace: originInput.place, destinationPlace: destinationInput.place, vehicleClass: form.get("vehicle"), roundTrip: form.get("trip") === "round" }) });
      const body = await response.json();
      if (!response.ok) {
        const message = body.message ?? "Could not calculate routes.";
        // Location errors are shown under the field they belong to.
        if (body.field === "origin" || body.field === "destination") setFieldErrors({ [body.field]: message }); else setError(message);
        return;
      }
      if (!Array.isArray(body.results) || body.results.length === 0) { setError("No driving routes were found for those places."); return; }
      setPlaces({ origin, destination }); setMarkers({ origin: body.places?.origin, destination: body.places?.destination }); setResults(body.results); setCoverageNotice(body.notice ?? ""); setUnavailablePreferences(body.unavailablePreferences ?? []); setSelected(0);
      if (signedIn) fetch("/api/account/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin, destination, vehicleClass: form.get("vehicle"), routeData: body.results[0] }) }).catch(() => undefined);
    } catch { setError("Could not contact the route service. Please try again."); }
    finally { setLoading(false); }
  }

  async function shareRoute() {
    if (!selectedRoute) return;
    const text = `${places.origin} to ${places.destination}: ${formatTime(selectedRoute.durationSeconds)}, ${(selectedRoute.distanceMeters / 1000).toFixed(1)} km, ${tollText(selectedRoute.toll)} via ${selectedRoute.expressways.join(" → ") || "the selected route"}.`;
    try { if (navigator.share) await navigator.share({ title: "Luzon Tollmap route", text }); else await navigator.clipboard.writeText(text); } catch { /* Native share cancellation is not an app error. */ }
  }

  async function saveSelectedRoute() {
    if (!selectedRoute) return;
    if (!signedIn) {
      const shouldSignIn = window.confirm("Sign in or create an account to save this route.");
      if (shouldSignIn) window.location.assign("/login?next=/");
      return;
    }
    const name = window.prompt("Name this saved route", `${places.origin} to ${places.destination}`);
    if (!name) return;
    const response = await fetch("/api/account/saved-routes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, origin: places.origin, destination: places.destination, vehicleClass: selectedRoute.toll.segments[0]?.vehicleClass ?? null, routeData: selectedRoute }) });
    const body = await response.json().catch(() => ({}));
    setError(response.ok ? "Route saved to your account." : body.message ?? "Could not save this route.");
  }

  if (access !== "dashboard") return <main className="welcomePage"><section className="welcomeCard" aria-busy={access === "checking"}>
    <div className="welcomeMark" aria-hidden="true">↗</div><div className="brand welcomeBrand">LUZON <span>TOLLMAP</span></div>
    <p className="welcomeCopy">Plan smarter trips across Luzon’s expressways.</p>
    {access === "checking" ? <p className="welcomeStatus">Loading your session…</p> : <div className="welcomeActions"><a className="welcomePrimary" href="/login">Log in</a><a className="welcomeSecondary" href="/register">Sign up</a><button className="guestButton" onClick={() => setAccess("dashboard")}>Continue as Guest</button></div>}
  </section></main>;

  return <main className="shell">
    <header className="top"><div className="brand">LUZON <span>TOLLMAP</span></div><nav className="nav"><a href="/tollways">Tollways</a>{authEnabled && <a href="/trips">My trips</a>}<AuthLinks /></nav></header>
    <section className="layout">
      <aside className="sidebar" aria-label="Trip planner">
      <form className="panel" onSubmit={calculate}>
        <div className="eyebrow">LUZON, PHILIPPINES</div><h1>Luzon Expressway Toll Route Planner</h1><p className="regionNote">Plan routes and estimate toll fees across supported expressways in Luzon, Philippines.</p>
        <PlaceAutocomplete id="from" name="from" label="FROM" required placeholder="Enter a location in Luzon" value={originInput.text} error={fieldErrors.origin} onChange={(text, place, invalid) => { setOriginInput({ text, place }); setFieldErrors((current) => ({ ...current, origin: invalid })); }}/>
        <PlaceAutocomplete id="to" name="to" label="TO" required placeholder="Enter a destination in Luzon" value={destinationInput.text} error={fieldErrors.destination} onChange={(text, place, invalid) => { setDestinationInput({ text, place }); setFieldErrors((current) => ({ ...current, destination: invalid })); }}/>
        <div className="row"><div className="field"><label htmlFor="vehicle">VEHICLE</label><select name="vehicle" id="vehicle"><option value="CLASS_1">Class 1</option><option value="CLASS_2">Class 2</option><option value="CLASS_3">Class 3</option></select></div><div className="field"><label htmlFor="trip">TRIP TYPE</label><select name="trip" id="trip"><option value="one-way">One way</option><option value="round">Round trip</option></select></div></div>
        <button className="calculate" disabled={loading}>{loading ? "Calculating…" : "Calculate routes"}</button>
        {error && <p role="alert" className="hint">{error}</p>}
      </form>
      <div className="sectionLabel">ROUTE OPTIONS</div>
      {results.length > 0 && markers.origin && markers.destination && <p className="resolvedPlaces"><span title={markers.origin.address}><i className="pin a">A</i>{markers.origin.address ?? markers.origin.name}</span><span title={markers.destination.address}><i className="pin b">B</i>{markers.destination.address ?? markers.destination.name}</span></p>}
      {results.length === 0 && <p className="emptyRoutes">{loading ? "Finding Fastest, Balanced, and Avoid Tolls routes…" : "Fastest, Balanced, and Avoid Tolls routes appear here after you calculate."}</p>}
      {results.length > 0 && <div className="cards" aria-label="Route alternatives">{results.map((route, index) => {
        const unavailable = databaseOffline(route.toll); const estimated = route.toll.status === "ESTIMATED";
        return <button type="button" className={`card ${index === selected ? "selected" : ""}`} onClick={() => setSelected(index)} key={route.id}>
          <div className="cardTop"><b>{(route.preferences?.map((preference) => labels[preference]) ?? [labels[route.mode]]).join(" · ")}</b><span>{index === selected ? "SELECTED" : route.toll.status}</span></div>
          <h2>{route.expressways.join(" → ") || (route.mode === "AVOID_TOLLS" ? "No toll roads detected" : route.toll.noExpressway ? "Ordinary roads · no expressway" : "Toll road not in supported network")}</h2>
          <div className="stats"><span>{formatTime(route.durationSeconds)}</span><span>{(route.distanceMeters / 1000).toFixed(1)} km</span></div><div className="toll">{tollText(route.toll)}</div>
          {estimated && <small className="estimateNote">Estimate · verify before travel</small>}
          {unavailable ? <small className="cardNote">Start PostgreSQL to load verified plaza and toll-rate data.</small> : route.toll.segments.map((segment) => <small className="segment" key={`${segment.expressway}-${segment.exitExpressway ?? ""}-${segment.entry}`}>{segment.exitExpressway ? `${segment.expressway}–${segment.exitExpressway} (${segment.entry} → ${segment.exit})` : segment.expressway} · {vehicleLabel(segment.vehicleClass)}: {segment.tollCentavos === undefined ? `${segment.entry} → ${segment.exit}: rate unavailable` : `${currency(segment.tollCentavos)}${segment.estimate ? " estimate" : ""}`}</small>)}
          {route.toll.warnings?.map((warning) => <small className="cardNote" key={warning}>{warning}</small>)}
        </button>;
      })}</div>}
      {coverageNotice && <p className="rankingNote" role="status">{coverageNotice} The routes below use ordinary roads only.</p>}
      {unavailablePreferences.includes("CHEAPEST") && !coverageNotice && <p className="rankingNote">Cheapest is unavailable until a route has a complete verified toll total.</p>}
      <div className="sectionLabel">FUEL</div>
      <div className="row fuelRow"><div className="field"><label htmlFor="efficiency">FUEL EFFICIENCY (KM/L)</label><input id="efficiency" inputMode="decimal" min="0" placeholder="Optional" value={fuelEfficiency} onChange={(event) => setFuelEfficiency(event.target.value)}/></div><div className="field"><label htmlFor="price">FUEL PRICE (₱/L)</label><input id="price" inputMode="decimal" min="0" placeholder="Optional" value={fuelPrice} onChange={(event) => setFuelPrice(event.target.value)}/></div></div>
      {selectedRoute && <div className="tripSummary"><b>Trip cost summary</b><span>Tolls: {selectedRoute.toll.totalCentavos === undefined ? "Unavailable" : tollText(selectedRoute.toll)}</span>{fuelEstimate !== undefined && <span>Fuel estimate: ₱{fuelEstimate.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}{selectedRoute.toll.totalCentavos !== undefined && fuelEstimate !== undefined && <strong>Estimated total: {currency(selectedRoute.toll.totalCentavos + Math.round(fuelEstimate * 100))}</strong>}<div className="summaryActions"><button type="button" className="share" onClick={shareRoute}>Share selected route</button>{authEnabled && <button type="button" className="share" onClick={saveSelectedRoute}>{signedIn ? "Save selected route" : "Log in to save route"}</button>}</div></div>}
      <p className="notice"><b>Rate trust matters.</b> A total appears only when all identified toll segments have valid rate data. Verified fees use official sources; imported third-party matrix matches remain clearly marked estimates.</p>
      </aside>
      <div className="mapArea">
        <div className="mapFallback"><i className="road"/><i className="road r2"/><i className="road r3"/></div>
        <TollMap routes={routeGeometries} selected={selected} onSelect={setSelected} origin={markers.origin} destination={markers.destination}/>
        {results.length > 1 && <div className="mapBadge">Click a grey route on the map to compare alternatives</div>}
      </div>
    </section>
  </main>;
}
