"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { TollMap, type RouteGeometry } from "@/components/toll-map";
import { AuthLinks } from "@/components/auth-links";

type TollStatus = "VERIFIED" | "ESTIMATED" | "INCOMPLETE" | "UNAVAILABLE";
type RouteMode = "FASTEST" | "CHEAPEST" | "BALANCED" | "AVOID_TOLLS";
type TollSegment = { expressway: string; entry: string; exit: string; vehicleClass: "CLASS_1" | "CLASS_2" | "CLASS_3"; tollCentavos?: number; estimate?: boolean; warning?: string };
type Toll = { totalCentavos?: number; status: TollStatus; tollsAvoided?: boolean; segments: TollSegment[]; warnings?: string[] };
type Result = { id: string; mode: RouteMode; preferences?: RouteMode[]; distanceMeters: number; durationSeconds: number; expressways: string[]; toll: Toll; geometry: RouteGeometry };

const labels: Record<RouteMode, string> = { FASTEST: "FASTEST", CHEAPEST: "CHEAPEST", BALANCED: "BALANCED", AVOID_TOLLS: "AVOID TOLLS" };
const formatTime = (seconds: number) => `${Math.floor(seconds / 3600)} hr ${Math.round((seconds % 3600) / 60)} min`;
const vehicleLabel = (vehicle: TollSegment["vehicleClass"]) => vehicle.replace("_", " ");
const currency = (centavos: number) => `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
const databaseOffline = (toll: Toll) => toll.segments.some((segment) => segment.warning?.includes("Rate database is currently unavailable"));

function tollText(toll: Toll) {
  if (toll.tollsAvoided) return "₱0 · tolls avoided";
  if (databaseOffline(toll)) return "Toll data unavailable";
  if (toll.totalCentavos !== undefined) return currency(toll.totalCentavos);
  return toll.status === "UNAVAILABLE" ? "Rate unavailable" : toll.status === "INCOMPLETE" ? "Incomplete toll data" : "Estimated toll";
}

export default function Home() {
  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unavailablePreferences, setUnavailablePreferences] = useState<RouteMode[]>([]);
  const [places, setPlaces] = useState({ origin: "", destination: "" });
  const [fuelEfficiency, setFuelEfficiency] = useState("");
  const [fuelPrice, setFuelPrice] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [access, setAccess] = useState<"checking" | "welcome" | "dashboard">("checking");
  const selectedRoute = results[selected];
  const fuelEstimate = useMemo(() => {
    const efficiency = Number(fuelEfficiency); const price = Number(fuelPrice);
    if (!selectedRoute || !Number.isFinite(efficiency) || efficiency <= 0 || !Number.isFinite(price) || price <= 0) return undefined;
    return selectedRoute.distanceMeters / 1000 / efficiency * price;
  }, [selectedRoute, fuelEfficiency, fuelPrice]);

  useEffect(() => { fetch("/api/auth/session").then((response) => response.json()).then((body) => { const authenticated = Boolean(body.user); setSignedIn(authenticated); setAccess(authenticated ? "dashboard" : "welcome"); }).catch(() => setAccess("welcome")); }, []);

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError(""); setResults([]); setUnavailablePreferences([]);
    const form = new FormData(event.currentTarget);
    const origin = String(form.get("from") ?? "").trim(); const destination = String(form.get("to") ?? "").trim();
    try {
      const response = await fetch("/api/routes/calculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin, destination, vehicleClass: form.get("vehicle"), roundTrip: form.get("trip") === "round" }) });
      const body = await response.json();
      if (!response.ok) { setError(body.message ?? "Could not calculate routes."); return; }
      if (!Array.isArray(body.results) || body.results.length === 0) { setError("No driving routes were found for those places."); return; }
      setPlaces({ origin, destination }); setResults(body.results); setUnavailablePreferences(body.unavailablePreferences ?? []); setSelected(0);
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
    <header className="top"><div className="brand">LUZON <span>TOLLMAP</span></div><nav className="nav"><a href="/tollways">Tollways</a><a href="/trips">My trips</a><AuthLinks /></nav></header>
    <section className="layout">
      <div className="mapFallback"><i className="road"/><i className="road r2"/><i className="road r3"/></div>
      <TollMap route={selectedRoute?.geometry}/><div className="mapBadge">Route provider selected from configuration · animated selected route</div>
      <form className="panel" onSubmit={calculate}>
        <div className="eyebrow">LUZON EXPRESSWAY PLANNER</div><h1>Plan your trip. Know your toll estimate.</h1>
        <div className="field"><label htmlFor="from">FROM</label><input name="from" id="from" required placeholder="City, landmark, or toll plaza" defaultValue="Baguio City"/></div>
        <div className="field"><label htmlFor="to">TO</label><input name="to" id="to" required placeholder="Destination" defaultValue="Manila"/></div>
        <div className="row"><div className="field"><label htmlFor="vehicle">VEHICLE</label><select name="vehicle" id="vehicle"><option value="CLASS_1">Class 1</option><option value="CLASS_2">Class 2</option><option value="CLASS_3">Class 3</option></select></div><div className="field"><label htmlFor="trip">TRIP TYPE</label><select name="trip" id="trip"><option value="one-way">One way</option><option value="round">Round trip</option></select></div></div>
        <div className="row"><div className="field"><label htmlFor="efficiency">FUEL EFFICIENCY (KM/L)</label><input id="efficiency" inputMode="decimal" min="0" placeholder="Optional" value={fuelEfficiency} onChange={(event) => setFuelEfficiency(event.target.value)}/></div><div className="field"><label htmlFor="price">FUEL PRICE (₱/L)</label><input id="price" inputMode="decimal" min="0" placeholder="Optional" value={fuelPrice} onChange={(event) => setFuelPrice(event.target.value)}/></div></div>
        <button className="calculate" disabled={loading}>{loading ? "Calculating…" : "Calculate routes"}</button>
        <p className="hint">Verified fees use official sources. Imported third-party matrix matches remain clearly marked estimates.</p>{error && <p role="alert" className="hint">{error}</p>}
      </form>
      {results.length > 0 && <div className="cards" aria-label="Route alternatives">{results.map((route, index) => {
        const unavailable = databaseOffline(route.toll); const estimated = route.toll.status === "ESTIMATED";
        return <button type="button" className={`card ${index === selected ? "selected" : ""}`} onClick={() => setSelected(index)} key={route.id}>
          <div className="cardTop"><b>{(route.preferences?.map((preference) => labels[preference]) ?? [labels[route.mode]]).join(" · ")}</b><span>{index === selected ? "SELECTED" : route.toll.status}</span></div>
          <h2>{route.expressways.join(" → ") || (route.mode === "AVOID_TOLLS" ? "No toll roads detected" : "Toll-road match unavailable")}</h2>
          <div className="stats"><span>{formatTime(route.durationSeconds)}</span><span>{(route.distanceMeters / 1000).toFixed(1)} km</span></div><div className="toll">{tollText(route.toll)}</div>
          {estimated && <small className="estimateNote">Estimate · verify before travel</small>}
          {unavailable ? <small className="cardNote">Start PostgreSQL to load verified plaza and toll-rate data.</small> : route.toll.segments.map((segment) => <small className="segment" key={`${segment.expressway}-${segment.entry}`}>{segment.expressway} · {vehicleLabel(segment.vehicleClass)}: {segment.tollCentavos === undefined ? `${segment.entry} → ${segment.exit}: rate unavailable` : `${currency(segment.tollCentavos)}${segment.estimate ? " estimate" : ""}`}</small>)}
          {route.toll.warnings?.map((warning) => <small className="cardNote" key={warning}>{warning}</small>)}
        </button>;
      })}</div>}
      {selectedRoute && <aside className="tripSummary"><b>Trip cost summary</b><span>Tolls: {selectedRoute.toll.totalCentavos === undefined ? "Unavailable" : tollText(selectedRoute.toll)}</span>{fuelEstimate !== undefined && <span>Fuel estimate: ₱{fuelEstimate.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}{selectedRoute.toll.totalCentavos !== undefined && fuelEstimate !== undefined && <strong>Estimated total: {currency(selectedRoute.toll.totalCentavos + Math.round(fuelEstimate * 100))}</strong>}<button type="button" className="share" onClick={shareRoute}>Share selected route</button><button type="button" className="share" onClick={saveSelectedRoute}>{signedIn ? "Save selected route" : "Log in to save route"}</button></aside>}
      {unavailablePreferences.includes("CHEAPEST") && <aside className="rankingNote">Cheapest is unavailable until a route has a complete verified toll total.</aside>}
      <aside className="notice"><b>Rate trust matters.</b><br/>A total appears only when all identified toll segments have valid rate data. Estimates are never presented as verified fees.</aside>
    </section>
  </main>;
}
